import { z } from "zod";

import {
  CourseSchema,
  LinkedSystemSchema,
  SchoolProfileSchema,
  SchoolScanSchema,
  type Course,
  type LinkedSystem,
  type SchoolProfile,
  type SchoolScan,
} from "../../shared/index.js";
import type { StudiSqliteDatabase } from "./database.js";
import { StorageError, errorMessage } from "./errors.js";

type JsonRow = { record_json: string };

function parseValue<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  try {
    return schema.parse(value);
  } catch (error) {
    throw new StorageError(
      "record_validation_failed",
      `Invalid ${label}: ${errorMessage(error)}`,
      { recordType: label },
      { cause: error },
    );
  }
}

function parseRow<T>(schema: z.ZodType<T>, row: JsonRow, label: string): T {
  try {
    return schema.parse(JSON.parse(row.record_json));
  } catch (error) {
    throw new StorageError(
      "record_validation_failed",
      `Stored ${label} failed validation: ${errorMessage(error)}`,
      { recordType: label },
      { cause: error },
    );
  }
}

function recordJson<T>(schema: z.ZodType<T>, value: T): string {
  return JSON.stringify(schema.parse(value));
}

function assertColumns(
  label: string,
  recordId: string,
  actual: Readonly<Record<string, string | null>>,
  expected: Readonly<Record<string, string | null>>,
): void {
  const mismatches = Object.keys(expected).filter((column) => actual[column] !== expected[column]);
  if (mismatches.length > 0) {
    throw new StorageError(
      "record_validation_failed",
      `Stored ${label} columns do not match the validated record JSON`,
      { recordId, mismatches },
    );
  }
}

export class SchoolRepository {
  constructor(private readonly database: StudiSqliteDatabase) {}

  putProfile(value: unknown): SchoolProfile {
    const profile = parseValue(SchoolProfileSchema, value, "school profile");
    this.database.handle.prepare(`
      INSERT INTO school_profile(singleton_id, updated_at, record_json)
      VALUES ('primary-school', ?, ?)
      ON CONFLICT(singleton_id) DO UPDATE SET
        updated_at = excluded.updated_at,
        record_json = excluded.record_json
    `).run(profile.updatedAt, recordJson(SchoolProfileSchema, profile));
    return profile;
  }

  getProfile(): SchoolProfile | null {
    const row = this.database.handle.prepare(`
      SELECT updated_at, record_json FROM school_profile WHERE singleton_id = 'primary-school'
    `).get() as (JsonRow & { updated_at: string }) | undefined;
    if (!row) return null;
    const profile = parseRow(SchoolProfileSchema, row, "school profile");
    assertColumns("school profile", profile.profileId, { updated_at: row.updated_at }, { updated_at: profile.updatedAt });
    return profile;
  }

  putScan(value: unknown): SchoolScan {
    const scan = parseValue(SchoolScanSchema, value, "school scan");
    this.database.handle.prepare(`
      INSERT INTO school_scans(scan_id, state, started_at, updated_at, completed_at, record_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(scan_id) DO UPDATE SET
        state = excluded.state,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at,
        record_json = excluded.record_json
    `).run(
      scan.scanId,
      scan.state,
      scan.startedAt,
      scan.updatedAt,
      scan.completedAt ?? null,
      recordJson(SchoolScanSchema, scan),
    );
    return scan;
  }

  getScan(scanId: string): SchoolScan | null {
    const row = this.database.handle.prepare(`
      SELECT state, started_at, updated_at, completed_at, record_json
      FROM school_scans WHERE scan_id = ?
    `).get(scanId) as (JsonRow & {
      state: string;
      started_at: string;
      updated_at: string;
      completed_at: string | null;
    }) | undefined;
    return row ? parseScanRow(scanId, row) : null;
  }

  latestScan(): SchoolScan | null {
    const row = this.database.handle.prepare(`
      SELECT scan_id, state, started_at, updated_at, completed_at, record_json
      FROM school_scans ORDER BY rowid DESC LIMIT 1
    `).get() as (JsonRow & {
      scan_id: string;
      state: string;
      started_at: string;
      updated_at: string;
      completed_at: string | null;
    }) | undefined;
    return row ? parseScanRow(row.scan_id, row) : null;
  }

  putCourse(value: unknown): Course {
    const course = parseValue(CourseSchema, value, "course");
    this.database.handle.prepare(`
      INSERT INTO courses(course_id, last_verified_scan_id, last_verified_at, record_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(course_id) DO UPDATE SET
        last_verified_scan_id = excluded.last_verified_scan_id,
        last_verified_at = excluded.last_verified_at,
        record_json = excluded.record_json
    `).run(
      course.courseId,
      course.lastVerifiedScanId,
      course.lastVerifiedAt,
      recordJson(CourseSchema, course),
    );
    return course;
  }

  listCourses(): Course[] {
    const rows = this.database.handle.prepare(`
      SELECT course_id, last_verified_scan_id, last_verified_at, record_json
      FROM courses ORDER BY course_id
    `).all() as unknown as Array<JsonRow & {
      course_id: string;
      last_verified_scan_id: string;
      last_verified_at: string;
    }>;
    return rows.map((row) => {
      const course = parseRow(CourseSchema, row, "course");
      assertColumns(
        "course",
        course.courseId,
        {
          course_id: row.course_id,
          last_verified_scan_id: row.last_verified_scan_id,
          last_verified_at: row.last_verified_at,
        },
        {
          course_id: course.courseId,
          last_verified_scan_id: course.lastVerifiedScanId,
          last_verified_at: course.lastVerifiedAt,
        },
      );
      return course;
    }).sort((left, right) => left.label.localeCompare(right.label));
  }

  putLinkedSystem(value: unknown): LinkedSystem {
    const system = parseValue(LinkedSystemSchema, value, "linked system");
    this.database.handle.prepare(`
      INSERT INTO linked_systems(
        linked_system_id, state, last_observed_scan_id, last_verified_scan_id,
        last_observed_at, record_json
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(linked_system_id) DO UPDATE SET
        state = excluded.state,
        last_observed_scan_id = excluded.last_observed_scan_id,
        last_verified_scan_id = excluded.last_verified_scan_id,
        last_observed_at = excluded.last_observed_at,
        record_json = excluded.record_json
    `).run(
      system.linkedSystemId,
      system.state,
      system.lastObservedScanId,
      system.lastVerifiedScanId ?? null,
      system.lastObservedAt,
      recordJson(LinkedSystemSchema, system),
    );
    return system;
  }

  getLinkedSystem(linkedSystemId: string): LinkedSystem | null {
    const row = this.database.handle.prepare(`
      SELECT record_json FROM linked_systems WHERE linked_system_id = ?
    `).get(linkedSystemId) as JsonRow | undefined;
    return row ? parseRow(LinkedSystemSchema, row, "linked system") : null;
  }

  listLinkedSystems(): LinkedSystem[] {
    const rows = this.database.handle.prepare(`
      SELECT linked_system_id, state, last_observed_scan_id, last_verified_scan_id,
        last_observed_at, record_json
      FROM linked_systems ORDER BY linked_system_id
    `).all() as unknown as Array<JsonRow & {
      linked_system_id: string;
      state: string;
      last_observed_scan_id: string;
      last_verified_scan_id: string | null;
      last_observed_at: string;
    }>;
    return rows.map((row) => {
      const system = parseRow(LinkedSystemSchema, row, "linked system");
      assertColumns(
        "linked system",
        system.linkedSystemId,
        {
          linked_system_id: row.linked_system_id,
          state: row.state,
          last_observed_scan_id: row.last_observed_scan_id,
          last_verified_scan_id: row.last_verified_scan_id,
          last_observed_at: row.last_observed_at,
        },
        {
          linked_system_id: system.linkedSystemId,
          state: system.state,
          last_observed_scan_id: system.lastObservedScanId,
          last_verified_scan_id: system.lastVerifiedScanId ?? null,
          last_observed_at: system.lastObservedAt,
        },
      );
      return system;
    }).sort((left, right) => left.label.localeCompare(right.label));
  }
}

function parseScanRow(
  scanId: string,
  row: JsonRow & {
    state: string;
    started_at: string;
    updated_at: string;
    completed_at: string | null;
  },
): SchoolScan {
  const scan = parseRow(SchoolScanSchema, row, "school scan");
  assertColumns(
    "school scan",
    scanId,
    {
      state: row.state,
      started_at: row.started_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
    },
    {
      state: scan.state,
      started_at: scan.startedAt,
      updated_at: scan.updatedAt,
      completed_at: scan.completedAt ?? null,
    },
  );
  return scan;
}

export function validateSchoolRecords(database: StudiSqliteDatabase): void {
  const repository = new SchoolRepository(database);
  repository.getProfile();
  repository.latestScan();
  const scanRows = database.handle.prepare("SELECT scan_id FROM school_scans").all() as unknown as Array<{ scan_id: string }>;
  for (const row of scanRows) repository.getScan(row.scan_id);
  repository.listCourses();
  repository.listLinkedSystems();
}
