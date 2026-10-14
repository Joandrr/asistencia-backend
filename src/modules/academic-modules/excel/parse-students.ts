import { isEmail } from 'class-validator';
import { cellText, isBlankCell, unwrapCell } from './cell-value';
import { ImportIssue } from './import-issue';
import { ColumnSpec, SheetRow } from './read-sheet';

export type StudentColumn = 'registrationNo' | 'fullName' | 'email';

export const STUDENT_COLUMNS: ColumnSpec<StudentColumn>[] = [
  {
    key: 'registrationNo',
    label: 'Número de registro',
    aliases: [
      'numero de registro',
      'nro de registro',
      'n de registro',
      'registro',
    ],
  },
  {
    key: 'fullName',
    label: 'Nombre completo',
    aliases: ['nombre completo', 'nombre', 'nombres'],
  },
  {
    key: 'email',
    label: 'Correo electrónico',
    aliases: ['correo electronico', 'correo', 'email', 'e mail'],
  },
];

export interface ParsedStudent {
  row: number;
  registrationNo: string;
  fullName: string;
  email: string;
}

const REGISTRATION_PATTERN = /^\d{7,12}$/;
const FULL_NAME_MAX = 200;
const EMAIL_MAX = 254;
const LABEL = Object.fromEntries(
  STUDENT_COLUMNS.map((column) => [column.key, column.label]),
) as Record<StudentColumn, string>;

export function parseStudents(rows: SheetRow<StudentColumn>[]): {
  students: ParsedStudent[];
  issues: ImportIssue[];
} {
  const students: ParsedStudent[] = [];
  const issues: ImportIssue[] = [];
  const rowByRegistration = new Map<string, number>();
  const rowByEmail = new Map<string, number>();

  for (const { row, values } of rows) {
    const issuesBefore = issues.length;
    const issue = (key: StudentColumn, message: string) =>
      issues.push({ file: 'students', row, column: LABEL[key], message });

    const registrationNo = parseRegistrationNo(values.registrationNo);
    const fullName = parseFullName(values.fullName);
    const email = parseEmail(values.email);

    if (registrationNo.error) issue('registrationNo', registrationNo.error);
    if (fullName.error) issue('fullName', fullName.error);
    if (email.error) issue('email', email.error);

    if (registrationNo.value) {
      const firstRow = rowByRegistration.get(registrationNo.value);
      if (firstRow !== undefined) {
        issue(
          'registrationNo',
          `El número de registro ${registrationNo.value} está repetido (ya aparece en la fila ${firstRow}).`,
        );
      } else {
        rowByRegistration.set(registrationNo.value, row);
      }
    }
    if (email.value) {
      const firstRow = rowByEmail.get(email.value);
      if (firstRow !== undefined) {
        issue(
          'email',
          `El correo ${email.value} está repetido (ya aparece en la fila ${firstRow}).`,
        );
      } else {
        rowByEmail.set(email.value, row);
      }
    }

    if (
      issues.length === issuesBefore &&
      registrationNo.value &&
      fullName.value &&
      email.value
    ) {
      students.push({
        row,
        registrationNo: registrationNo.value,
        fullName: fullName.value,
        email: email.value,
      });
    }
  }

  return { students, issues };
}

type Parsed =
  { value: string; error?: undefined } | { value?: undefined; error: string };

function parseRegistrationNo(raw: unknown): Parsed {
  if (isBlankCell(raw))
    return { error: 'El número de registro es obligatorio.' };
  const value = unwrapCell(raw);
  let text: string | null = null;
  if (typeof value === 'number') {
    // Numeric cells must be whole numbers; decimals mean a typing mistake.
    if (Number.isSafeInteger(value) && value >= 0) text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  }
  if (text === null || !REGISTRATION_PATTERN.test(text)) {
    return {
      error:
        'El número de registro debe tener entre 7 y 12 dígitos, sin letras, espacios ni decimales.',
    };
  }
  return { value: text };
}

function parseFullName(raw: unknown): Parsed {
  if (isBlankCell(raw)) return { error: 'El nombre completo es obligatorio.' };
  const text = cellText(raw)?.replace(/\s+/g, ' ').trim() ?? '';
  if (!/\p{L}/u.test(text)) {
    return { error: 'El nombre completo debe contener letras.' };
  }
  if (text.length > FULL_NAME_MAX) {
    return {
      error: `El nombre completo no puede superar ${FULL_NAME_MAX} caracteres.`,
    };
  }
  return { value: text };
}

function parseEmail(raw: unknown): Parsed {
  if (isBlankCell(raw))
    return { error: 'El correo electrónico es obligatorio.' };
  const text =
    cellText(raw)
      ?.replace(/^mailto:/i, '')
      .trim()
      .toLowerCase() ?? '';
  if (text.length > EMAIL_MAX || !isEmail(text)) {
    return { error: 'El correo electrónico no tiene un formato válido.' };
  }
  return { value: text };
}
