import 'dotenv/config';
import dataSource from './data-source';
import { Module } from './entities/module.entity';
import { ClassSchedule } from './entities/class-schedule.entity';
import { Enrollment } from './entities/enrollment.entity';
import { Attendance, AttendanceStatus } from './entities/attendance.entity';
import { User, UserRole } from '../modules/users/entities/user.entity';

async function seedDemoData(): Promise<void> {
  await dataSource.initialize();
  try {
    const userRepo = dataSource.getRepository(User);
    const moduleRepo = dataSource.getRepository(Module);
    const scheduleRepo = dataSource.getRepository(ClassSchedule);
    const enrollmentRepo = dataSource.getRepository(Enrollment);
    const attendanceRepo = dataSource.getRepository(Attendance);

    // Find our student users (123456 and 12345600)
    const students = await userRepo.find({
      where: { role: UserRole.STUDENT },
    });

    if (students.length === 0) {
      console.warn('No students found. Run seed:student first.');
      return;
    }

    // 1. Create or ensure Modules exist
    const moduleNames = [
      'Sistemas Operativos II (INF-312)',
      'Base de Datos II (INF-323)',
      'Redes de Computadoras (INF-318)',
    ];

    const createdModules: Module[] = [];
    for (const name of moduleNames) {
      let mod = await moduleRepo.findOne({ where: { name } });
      if (!mod) {
        // RN-01 allows a single active module (enforced by a unique index);
        // demo modules are created inactive. The active one is set by importing.
        mod = moduleRepo.create({ name, isActive: false });
        mod = await moduleRepo.save(mod);
      }
      createdModules.push(mod);
    }

    // 2. Enroll all students in these modules
    for (const student of students) {
      for (const mod of createdModules) {
        const existingEnrollment = await enrollmentRepo.findOne({
          where: { studentId: student.id, moduleId: mod.id },
        });
        if (!existingEnrollment) {
          await enrollmentRepo.save(
            enrollmentRepo.create({
              studentId: student.id,
              moduleId: mod.id,
            }),
          );
        }
      }
    }

    // Current Bolivia Date (e.g. 2026-10-13)
    const now = new Date();
    const todayDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/La_Paz',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    // 3. Create Schedules
    // Class 1: Active right now! (e.g. 22:00:00 to 23:59:00) in Module 0
    let activeSchedule = await scheduleRepo.findOne({
      where: { moduleId: createdModules[0].id, classDate: todayDate, startTime: '22:00:00' },
    });
    if (!activeSchedule) {
      activeSchedule = await scheduleRepo.save(
        scheduleRepo.create({
          moduleId: createdModules[0].id,
          classDate: todayDate,
          startTime: '22:00:00',
          graceTime: '23:30:00',
          endTime: '23:59:00',
        }),
      );
    }

    // Class 2: Past today (e.g. 07:00:00 to 09:15:00) in Module 1
    let pastTodaySchedule = await scheduleRepo.findOne({
      where: { moduleId: createdModules[1].id, classDate: todayDate, startTime: '07:00:00' },
    });
    if (!pastTodaySchedule) {
      pastTodaySchedule = await scheduleRepo.save(
        scheduleRepo.create({
          moduleId: createdModules[1].id,
          classDate: todayDate,
          startTime: '07:00:00',
          graceTime: '07:15:00',
          endTime: '09:15:00',
        }),
      );
    }

    // Class 3: Future today / tomorrow in Module 2
    let tomorrowSchedule = await scheduleRepo.findOne({
      where: { moduleId: createdModules[2].id, classDate: '2026-10-14', startTime: '14:00:00' },
    });
    if (!tomorrowSchedule) {
      tomorrowSchedule = await scheduleRepo.save(
        scheduleRepo.create({
          moduleId: createdModules[2].id,
          classDate: '2026-10-14',
          startTime: '14:00:00',
          graceTime: '14:15:00',
          endTime: '16:00:00',
        }),
      );
    }

    // 4. Past historical classes for rich history
    const pastDates = ['2026-10-06', '2026-10-08', '2026-10-11'];
    for (const pDate of pastDates) {
      for (const mod of createdModules) {
        let pSched = await scheduleRepo.findOne({
          where: { moduleId: mod.id, classDate: pDate },
        });
        if (!pSched) {
          pSched = await scheduleRepo.save(
            scheduleRepo.create({
              moduleId: mod.id,
              classDate: pDate,
              startTime: '10:00:00',
              graceTime: '10:15:00',
              endTime: '12:00:00',
            }),
          );

          // Add attendance for some students
          for (const student of students) {
            const enrollment = await enrollmentRepo.findOne({
              where: { studentId: student.id, moduleId: mod.id },
            });
            if (enrollment) {
              const status =
                pDate === '2026-10-06'
                  ? AttendanceStatus.PRESENT
                  : pDate === '2026-10-08'
                  ? AttendanceStatus.LATE
                  : AttendanceStatus.ABSENT;

              if (status !== AttendanceStatus.ABSENT) {
                await attendanceRepo.save(
                  attendanceRepo.create({
                    enrollmentId: enrollment.id,
                    scheduleId: pSched.id,
                    status,
                    markedAt: new Date(`${pDate}T10:10:00-04:00`),
                    notes: 'Marcado en fecha de clase',
                  }),
                );
              }
            }
          }
        }
      }
    }

    // 5. Next week real schedules (19 al 23 de octubre de 2026)
    const nextWeekSchedules = [
      // Lunes 19/10
      { modIdx: 1, date: '2026-10-19', start: '07:00:00', grace: '07:15:00', end: '09:15:00' },
      { modIdx: 2, date: '2026-10-19', start: '14:00:00', grace: '14:15:00', end: '16:15:00' },
      // Martes 20/10
      { modIdx: 0, date: '2026-10-20', start: '18:00:00', grace: '18:15:00', end: '20:15:00' },
      // Miércoles 21/10
      { modIdx: 1, date: '2026-10-21', start: '07:00:00', grace: '07:15:00', end: '09:15:00' },
      { modIdx: 2, date: '2026-10-21', start: '14:00:00', grace: '14:15:00', end: '16:15:00' },
      // Jueves 22/10
      { modIdx: 0, date: '2026-10-22', start: '18:00:00', grace: '18:15:00', end: '20:15:00' },
      // Viernes 23/10
      { modIdx: 1, date: '2026-10-23', start: '07:00:00', grace: '07:15:00', end: '09:15:00' },
      { modIdx: 2, date: '2026-10-23', start: '14:00:00', grace: '14:15:00', end: '16:15:00' },
    ];

    for (const item of nextWeekSchedules) {
      const targetMod = createdModules[item.modIdx];
      let existingSched = await scheduleRepo.findOne({
        where: { moduleId: targetMod.id, classDate: item.date, startTime: item.start },
      });
      if (!existingSched) {
        await scheduleRepo.save(
          scheduleRepo.create({
            moduleId: targetMod.id,
            classDate: item.date,
            startTime: item.start,
            graceTime: item.grace,
            endTime: item.end,
          }),
        );
      }
    }

    console.info('Demo academic data seeded successfully with next week schedules!');
  } finally {
    await dataSource.destroy();
  }
}

void seedDemoData().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : 'Unknown error while seeding demo data';
  console.error(message);
  process.exitCode = 1;
});
