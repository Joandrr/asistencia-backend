import { Controller, Get, Param, Query, StreamableFile } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ParseNumericIdPipe } from '../../common/numeric-id';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { AttendanceAdminService } from './attendance-admin.service';
import { AttendanceByDateDto } from './dto/attendance-by-date.dto';
import { ListModuleStudentsDto } from './dto/list-module-students.dto';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('Attendance administration')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
@ApiForbiddenResponse({ description: 'Only administrators can access' })
@ApiNotFoundResponse({ description: 'No active module' })
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AttendanceAdminController {
  constructor(private readonly attendanceAdmin: AttendanceAdminService) {}

  @Get('students')
  @ApiOperation({
    summary: 'List students of the active module with attendance totals',
  })
  @ApiOkResponse({ description: 'Paginated students: { module, data, meta }' })
  listStudents(@Query() query: ListModuleStudentsDto) {
    return this.attendanceAdmin.listStudents(query);
  }

  @Get('attendance/summary')
  @ApiOperation({
    summary: 'Active module attendance totals and per-date totals',
  })
  @ApiOkResponse({ description: '{ module, today, totals, schedules }' })
  getSummary() {
    return this.attendanceAdmin.getSummary();
  }

  @Get('attendance/by-date')
  @ApiOperation({ summary: 'Attendance of every student on one class date' })
  @ApiOkResponse({ description: '{ module, schedule, totals, data, meta }' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  getByDate(@Query() query: AttendanceByDateDto) {
    return this.attendanceAdmin.getByDate(query);
  }

  @Get('attendance/by-student/:studentId')
  @ApiOperation({ summary: 'Attendance of one student on every class date' })
  @ApiParam({ name: 'studentId', example: '4' })
  @ApiOkResponse({ description: '{ module, student, totals, records }' })
  @ApiBadRequestResponse({ description: 'Invalid student id' })
  getByStudent(@Param('studentId', ParseNumericIdPipe) studentId: string) {
    return this.attendanceAdmin.getByStudent(studentId);
  }

  @Get('attendance/export')
  @ApiOperation({ summary: 'Export active module attendance to Excel' })
  @ApiOkResponse({ description: 'Excel (.xlsx) file' })
  async export() {
    return new StreamableFile(await this.attendanceAdmin.exportWorkbook(), {
      type: XLSX_CONTENT_TYPE,
      disposition: 'attachment; filename="asistencias.xlsx"',
    });
  }
}
