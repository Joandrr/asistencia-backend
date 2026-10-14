import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { UserRole } from '../users/entities/user.entity';
import { AcademicModulesService } from './academic-modules.service';
import { ActivateModuleDto } from './dto/activate-module.dto';
import { buildTemplate, TEMPLATE_FILENAMES } from './excel/templates';
import type { TemplateKind } from './excel/templates';
import {
  IMPORT_FILE_FIELDS,
  requireImportFiles,
  XLSX_UPLOAD_OPTIONS,
} from './xlsx-upload';
import type { UploadedImportFiles } from './xlsx-upload';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const FILE_PROPERTIES = {
  students: {
    type: 'string',
    format: 'binary',
    description:
      'Excel (.xlsx): Número de registro, Nombre completo, Correo electrónico',
  },
  schedules: {
    type: 'string',
    format: 'binary',
    description: 'Excel (.xlsx): Fecha, Hora inicio, Hora fin',
  },
};

@ApiTags('Modules')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
@ApiForbiddenResponse({ description: 'Only administrators can manage modules' })
@Roles(UserRole.ADMIN)
@Controller('modules')
export class AcademicModulesController {
  constructor(
    private readonly academicModulesService: AcademicModulesService,
  ) {}

  @Get('active')
  @ApiOperation({ summary: 'Get the active module summary (admin only)' })
  @ApiOkResponse({ description: 'Active module, or activeModule: null' })
  getActive() {
    return this.academicModulesService.getActiveModuleSummary();
  }

  @Get('templates/:kind')
  @ApiOperation({ summary: 'Download an empty import template (admin only)' })
  @ApiParam({ name: 'kind', enum: ['students', 'schedules'] })
  @ApiOkResponse({ description: 'Excel template file' })
  async downloadTemplate(
    @Param(
      'kind',
      new ParseEnumPipe({ students: 'students', schedules: 'schedules' }),
    )
    kind: TemplateKind,
  ) {
    return new StreamableFile(await buildTemplate(kind), {
      type: XLSX_CONTENT_TYPE,
      disposition: `attachment; filename="${TEMPLATE_FILENAMES[kind]}"`,
    });
  }

  @Post('import/preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileFieldsInterceptor(IMPORT_FILE_FIELDS, XLSX_UPLOAD_OPTIONS),
  )
  @ApiOperation({
    summary:
      'Validate students and class dates files without saving (admin only)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['students', 'schedules'],
      properties: FILE_PROPERTIES,
    },
  })
  @ApiOkResponse({ description: 'Preview with row-level errors and warnings' })
  @ApiBadRequestResponse({ description: 'Missing or non-.xlsx files' })
  @ApiPayloadTooLargeResponse({ description: 'A file exceeds 2 MB' })
  preview(@UploadedFiles() files: UploadedImportFiles) {
    return this.academicModulesService.preview(requireImportFiles(files));
  }

  @Post('activate')
  @UseInterceptors(
    FileFieldsInterceptor(IMPORT_FILE_FIELDS, XLSX_UPLOAD_OPTIONS),
  )
  @ApiOperation({
    summary:
      'Activate a new module from the students and class dates files (admin only)',
    description:
      'Deactivates the current module (its data is kept) and creates the new active module with no attendance records.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'confirm', 'students', 'schedules'],
      properties: {
        name: { type: 'string', maxLength: 150 },
        confirm: { type: 'string', enum: ['true'] },
        ...FILE_PROPERTIES,
      },
    },
  })
  @ApiCreatedResponse({ description: 'Module activated' })
  @ApiBadRequestResponse({
    description: 'Invalid name, missing confirmation or files',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Files contain row-level errors',
  })
  @ApiConflictResponse({ description: 'Data changed during activation' })
  @ApiPayloadTooLargeResponse({ description: 'A file exceeds 2 MB' })
  activate(
    @Body() dto: ActivateModuleDto,
    @UploadedFiles() files: UploadedImportFiles,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.academicModulesService.activate(
      dto.name,
      requireImportFiles(files),
      actor,
    );
  }
}
