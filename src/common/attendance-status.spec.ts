import { BadRequestException } from '@nestjs/common';
import {
  attendanceRate,
  effectiveStatus,
  isClassOver,
} from './attendance-status';
import { nowInTimezone } from './clock';
import { ParseNumericIdPipe } from './numeric-id';

const NOW = { date: '2026-10-14', time: '18:30:00' };

describe('effective attendance status', () => {
  it('maps stored marks: excused counts as present, late stays late', () => {
    for (const stored of ['present', 'excused']) {
      expect(effectiveStatus(stored, '2026-10-01', '21:00:00', NOW)).toBe(
        'present',
      );
    }
    expect(effectiveStatus('late', '2026-10-01', '21:00:00', NOW)).toBe('late');
    expect(effectiveStatus('absent', '2026-10-20', '21:00:00', NOW)).toBe(
      'absent',
    );
  });

  it('turns a missing mark into an absence once the class is over', () => {
    expect(effectiveStatus(null, '2026-10-13', '21:00:00', NOW)).toBe('absent');
    expect(effectiveStatus(null, '2026-10-14', '18:00:00', NOW)).toBe('absent');
    expect(effectiveStatus(null, '2026-10-14', '18:30:00', NOW)).toBe(
      'pending',
    );
    expect(effectiveStatus(null, '2026-10-14', '21:00:00', NOW)).toBe(
      'pending',
    );
    expect(effectiveStatus(null, '2026-10-15', '08:00:00', NOW)).toBe(
      'pending',
    );
    expect(isClassOver('2026-10-14', '18:29:59', NOW)).toBe(true);
  });

  it('computes the attendance rate over evaluated classes only', () => {
    expect(attendanceRate(0, 0, 0)).toBeNull();
    expect(attendanceRate(3, 0, 0)).toBe(100);
    expect(attendanceRate(0, 0, 4)).toBe(0);
    expect(attendanceRate(2, 0, 1)).toBe(67);
    expect(attendanceRate(1, 0, 2)).toBe(33);
    // Late marks count as attended.
    expect(attendanceRate(0, 3, 0)).toBe(100);
    expect(attendanceRate(1, 1, 2)).toBe(50);
  });
});

describe('clock and ids', () => {
  it('formats local date and 24h time in the given timezone', () => {
    // 2026-10-15 03:15 UTC is still the 14th in La Paz (UTC-4).
    const local = nowInTimezone(
      'America/La_Paz',
      new Date(Date.UTC(2026, 9, 15, 3, 15, 5)),
    );
    expect(local).toEqual({ date: '2026-10-14', time: '23:15:05' });
    const midnight = nowInTimezone(
      'America/La_Paz',
      new Date(Date.UTC(2026, 9, 15, 4, 0, 0)),
    );
    expect(midnight).toEqual({ date: '2026-10-15', time: '00:00:00' });
  });

  it('accepts only ids that fit in a bigint', () => {
    const pipe = new ParseNumericIdPipe();
    expect(pipe.transform('42')).toBe('42');
    for (const bad of [
      '0',
      '-1',
      '1.5',
      'abc',
      '1 OR 1=1',
      '1234567890123456789',
    ]) {
      expect(() => pipe.transform(bad)).toThrow(BadRequestException);
    }
  });
});
