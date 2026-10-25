import { describe, it, expect } from 'vitest';
import {
  getDescriptor,
  getMasteryStatus,
  detectZipGradeItemCount,
  extractZipGradeKey,
  parseZipGradeRow,
  answersMatch,
  MIN_ITEMS_FOR_EVIDENCE,
  hasEnoughEvidence,
  getReportedStatus,
  getGapScope,
  computeSchoolYear,
  pooledPercentage,
  discriminationReadiness,
  itemRestCorrelation,
} from '../grading.js';

describe('getDescriptor', () => {
  it('returns Outstanding for 90 and above', () => {
    expect(getDescriptor(90)).toBe('Outstanding');
    expect(getDescriptor(100)).toBe('Outstanding');
  });

  it('returns Very Satisfactory for 85-89', () => {
    expect(getDescriptor(85)).toBe('Very Satisfactory');
    expect(getDescriptor(89.99)).toBe('Very Satisfactory');
  });

  it('returns Satisfactory for 80-84', () => {
    expect(getDescriptor(80)).toBe('Satisfactory');
    expect(getDescriptor(84.5)).toBe('Satisfactory');
  });

  it('returns Fairly Satisfactory for 75-79', () => {
    expect(getDescriptor(75)).toBe('Fairly Satisfactory');
    expect(getDescriptor(79.99)).toBe('Fairly Satisfactory');
  });

  it('returns Did Not Meet Expectations below 75', () => {
    expect(getDescriptor(74.99)).toBe('Did Not Meet Expectations');
    expect(getDescriptor(0)).toBe('Did Not Meet Expectations');
  });

  // Boundary values matter a lot here — Table 1 in the paper defines these
  // cutoffs as hard grading-scale boundaries, so off-by-one-percent bugs
  // silently misgrade real students right at the edge of a descriptor band.
  it('treats each cutoff boundary as inclusive of the higher band', () => {
    expect(getDescriptor(89.99)).not.toBe('Outstanding');
    expect(getDescriptor(84.99)).not.toBe('Very Satisfactory');
    expect(getDescriptor(79.99)).not.toBe('Satisfactory');
    expect(getDescriptor(74.99)).not.toBe('Fairly Satisfactory');
  });
});

describe('getMasteryStatus', () => {
  it('is Mastered at and above 80%', () => {
    expect(getMasteryStatus(80)).toBe('Mastered');
    expect(getMasteryStatus(100)).toBe('Mastered');
  });

  it('is Learning Gap below 80%', () => {
    expect(getMasteryStatus(79.99)).toBe('Learning Gap');
    expect(getMasteryStatus(0)).toBe('Learning Gap');
  });
});

describe('detectZipGradeItemCount', () => {
  it('counts consecutive Stu columns starting at 1', () => {
    const row = { Stu1: 'A', Stu2: 'B', Stu3: 'C' };
    expect(detectZipGradeItemCount(row)).toBe(3);
  });

  it('returns 0 when no Stu columns are present', () => {
    expect(detectZipGradeItemCount({ FirstName: 'Juan' })).toBe(0);
  });

  it('stops at the first gap rather than counting sparse columns', () => {
    // Stu1 and Stu3 present but Stu2 missing — a malformed/edited export.
    // The detector must stop at the gap (returns 1), not skip over it,
    // since a skipped item would silently misalign every answer after it.
    const row = { Stu1: 'A', Stu3: 'C' };
    expect(detectZipGradeItemCount(row)).toBe(1);
  });
});

describe('extractZipGradeKey', () => {
  it('pulls KeyN columns in order for the given item count', () => {
    const row = { Key1: 'A', Key2: 'B', Key3: 'C' };
    expect(extractZipGradeKey(row, 3)).toEqual(['A', 'B', 'C']);
  });

  it('fills missing keys with empty strings rather than throwing', () => {
    const row = { Key1: 'A' };
    expect(extractZipGradeKey(row, 3)).toEqual(['A', '', '']);
  });
});

describe('parseZipGradeRow', () => {
  it('returns realName built from FirstName + LastName, never a "codeName"', () => {
    const row = { FirstName: 'Juan', LastName: 'Dela Cruz', Stu1: 'A', Stu2: 'B' };
    const result = parseZipGradeRow(row);
    expect(result.realName).toBe('Juan Dela Cruz');
    expect(result).not.toHaveProperty('codeName');
  });

  it('uses ExternalID as matchKey when present, preferring it over the name', () => {
    const row = { FirstName: 'Juan', LastName: 'Dela Cruz', ExternalID: 'LRN-00123', Stu1: 'A' };
    const result = parseZipGradeRow(row);
    expect(result.matchKey).toBe('LRN-00123');
    expect(result.externalId).toBe('LRN-00123');
  });

  it('falls back to the full name as matchKey when ExternalID is absent', () => {
    const row = { FirstName: 'Ana', LastName: 'Reyes', Stu1: 'A' };
    const result = parseZipGradeRow(row);
    expect(result.matchKey).toBe('Ana Reyes');
  });

  it('falls back to the ZipGrade ID when neither name nor ExternalID is present', () => {
    const row = { ZipGradeID: '9981', Stu1: 'A' };
    const result = parseZipGradeRow(row);
    expect(result.matchKey).toBe('zg:9981');
  });

  it('produces an empty matchKey when no identity field is present at all', () => {
    const row = { Stu1: 'A' };
    const result = parseZipGradeRow(row);
    expect(result.matchKey).toBe('');
  });

  it('extracts StuN answers in order, trimmed', () => {
    const row = { FirstName: 'Juan', LastName: 'Cruz', Stu1: ' A ', Stu2: 'BC', Stu3: '' };
    const result = parseZipGradeRow(row);
    expect(result.answers).toEqual(['A', 'BC', '']);
    expect(result.itemCount).toBe(3);
  });
});

describe('answersMatch', () => {
  it('matches identical single-letter answers', () => {
    expect(answersMatch('A', 'A')).toBe(true);
    expect(answersMatch('A', 'B')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(answersMatch('a', 'A')).toBe(true);
  });

  it('treats multi-answer items as unordered sets ("AC" == "A,C")', () => {
    expect(answersMatch('AC', 'A,C')).toBe(true);
    expect(answersMatch('CA', 'A,C')).toBe(true);
  });

  it('rejects a blank student answer even against a blank key (no false positive)', () => {
    expect(answersMatch('', '')).toBe(false);
    expect(answersMatch('', 'A')).toBe(false);
  });

  it('ignores non-letter characters and duplicate letters when normalizing', () => {
    expect(answersMatch('A-A-C', 'AC')).toBe(true);
  });
});


// ── Evidence & scope rules ────────────────────────────────────────────────────
describe('hasEnoughEvidence / getReportedStatus', () => {
  it('requires at least MIN_ITEMS_FOR_EVIDENCE items', () => {
    expect(hasEnoughEvidence(MIN_ITEMS_FOR_EVIDENCE - 1)).toBe(false);
    expect(hasEnoughEvidence(MIN_ITEMS_FOR_EVIDENCE)).toBe(true);
  });

  it('never calls a gap on a competency with too few items', () => {
    // 2 of 3 items = 66.7% would be a "Learning Gap" on a long test, but 3
    // items is too little evidence to say so.
    expect(getReportedStatus(66.67, 3)).toBe('Insufficient Evidence');
    expect(getReportedStatus(100, 4)).toBe('Insufficient Evidence');
  });

  it('applies the 80% cutoff once there is enough evidence', () => {
    expect(getReportedStatus(80, 5)).toBe('Mastered');
    expect(getReportedStatus(60, 5)).toBe('Learning Gap');
    expect(getReportedStatus('79.99', 10)).toBe('Learning Gap');
  });
});

describe('getGapScope', () => {
  it('is None when nobody is below the cutoff or nobody was assessed', () => {
    expect(getGapScope(0, 20)).toBe('None');
    expect(getGapScope(0, 0)).toBe('None');
  });

  it('is a Small group below half the class, Class-wide at half or more', () => {
    expect(getGapScope(1, 40)).toBe('Small group');
    expect(getGapScope(19, 40)).toBe('Small group');
    expect(getGapScope(20, 40)).toBe('Class-wide');
    expect(getGapScope(40, 40)).toBe('Class-wide');
  });
});

describe('computeSchoolYear', () => {
  it('uses the year that opens in June', () => {
    expect(computeSchoolYear(new Date(2026, 5, 1))).toBe('2026-2027');  // June
    expect(computeSchoolYear(new Date(2026, 11, 31))).toBe('2026-2027'); // December
    expect(computeSchoolYear(new Date(2027, 0, 15))).toBe('2026-2027'); // January
    expect(computeSchoolYear(new Date(2027, 4, 31))).toBe('2026-2027'); // May
  });
});

// ── Trend pooling ─────────────────────────────────────────────────────────────
describe('pooledPercentage', () => {
  it('weights every item once instead of averaging result percentages', () => {
    // A 2-item quiz (1 correct) and a 20-item exam (18 correct).
    const rows = [
      { correct_items: 1, total_items: 2 },
      { correct_items: 18, total_items: 20 },
    ];
    // naive mean of the two percentages would be (50 + 90) / 2 = 70
    expect(pooledPercentage(rows)).toBeCloseTo(86.36, 2);
  });

  it('returns null when there are no items', () => {
    expect(pooledPercentage([])).toBeNull();
    expect(pooledPercentage([{ correct_items: 0, total_items: 0 }])).toBeNull();
  });
});

// ── Discrimination grouping ───────────────────────────────────────────────────
describe('discriminationReadiness', () => {
  it('does not compute under 10 students, indicative 10-29, reliable 30+', () => {
    expect(discriminationReadiness(5).canDiscriminate).toBe(false);
    expect(discriminationReadiness(12)).toMatchObject({ canDiscriminate: true, reliable: false });
    expect(discriminationReadiness(30)).toMatchObject({ canDiscriminate: true, reliable: true });
  });
});

describe('itemRestCorrelation (all students)', () => {
  it('is +1 when only the strongest students get the item right', () => {
    // totals include the item itself
    const item = [1, 1, 1, 0, 0, 0];
    const total = [5, 5, 4, 2, 1, 1];
    expect(itemRestCorrelation(item, total)).toBeGreaterThan(0.9);
  });
  it('is negative when weaker students get the item right', () => {
    const item = [0, 0, 0, 1, 1, 1];
    const total = [5, 5, 4, 3, 2, 2];
    expect(itemRestCorrelation(item, total)).toBeLessThan(0);
  });
  it('matches a hand calculation', () => {
    // item = [1,1,0,0], rest = total - item = [3,2,2,1]
    // mx=.5, my=2, sxy=(.5*1)+(.5*0)+(-.5*0)+(-.5*-1)=1, sxx=1, syy=2 -> 1/sqrt(2)
    expect(itemRestCorrelation([1, 1, 0, 0], [4, 3, 2, 1])).toBeCloseTo(0.7071, 4);
  });
  it('is null when everyone got it right/wrong or too few students', () => {
    expect(itemRestCorrelation([1, 1, 1, 1], [4, 3, 2, 1])).toBeNull();
    expect(itemRestCorrelation([0, 0, 0], [1, 2, 3])).toBeNull();
    expect(itemRestCorrelation([1], [3])).toBeNull();
  });
  it('does not depend on row order', () => {
    const item = [1, 0, 1, 0, 1, 1, 0], total = [6, 2, 5, 3, 4, 7, 1];
    const a = itemRestCorrelation(item, total);
    const b = itemRestCorrelation([...item].reverse(), [...total].reverse());
    expect(a).toBeCloseTo(b, 10);
  });
});
