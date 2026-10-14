import { GraceMinutes } from './grace-minutes';

export class UpdateGracePeriodDto {
  @GraceMinutes()
  graceMinutes!: number;
}
