import 'dotenv/config';
import { hash } from 'bcryptjs';
import dataSource from './data-source';
import { User, UserRole } from './entities/user.entity';

async function seedAdmin(): Promise<void> {
  const registrationNo = process.env.ADMIN_REGISTRATION_NO?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_FULL_NAME?.trim() || null;

  if (!registrationNo) {
    throw new Error('ADMIN_REGISTRATION_NO must be set in .env');
  }
  if (!password || password.length < 7 || password.length > 12) {
    throw new Error('ADMIN_PASSWORD must contain between 7 and 12 characters');
  }

  await dataSource.initialize();
  try {
    const users = dataSource.getRepository(User);
    const existingUser = await users.findOne({ where: { registrationNo } });

    if (existingUser) {
      if (existingUser.role !== UserRole.ADMIN) {
        throw new Error(
          `Registration number ${registrationNo} already belongs to a non-admin user; no changes made.`,
        );
      }

      console.info('Admin already exists; no changes made.');
      return;
    }

    const user = users.create({
      role: UserRole.ADMIN,
      registrationNo,
      passwordHash: await hash(password, 12),
      fullName,
      degreeProgram: null,
    });
    await users.save(user);
    console.info(
      `Initial admin created for registration number ${registrationNo}.`,
    );
  } finally {
    await dataSource.destroy();
  }
}

void seedAdmin().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : 'Unknown error while seeding admin';
  console.error(message);
  process.exitCode = 1;
});
