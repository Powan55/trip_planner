import { describe, it, expect } from 'vitest';
import { expensesToCsv } from '@/lib/expense-csv';
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
