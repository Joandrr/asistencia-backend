import { graceTimeFor } from './grace-period';

describe('graceTimeFor', () => {
  it('adds the grace minutes to the start time', () => {
    expect(graceTimeFor('18:00', '21:00', 10)).toBe('18:10');
    expect(graceTimeFor('07:50:00', '09:15:00', 15)).toBe('08:05');
    expect(graceTimeFor('18:00', '21:00', 0)).toBe('18:00');
  });

  it('never goes past the end of the class or wraps after midnight', () => {
    expect(graceTimeFor('18:00', '18:30', 45)).toBe('18:30');
    expect(graceTimeFor('23:30', '23:59', 60)).toBe('23:59');
    expect(graceTimeFor('00:00', '23:59', 240)).toBe('04:00');
  });
});
