/**
 * Shared test helpers.
 *
 * Provides a lightweight way to build ts-morph Projects seeded with
 * fixture files, and convenience wrappers around the trace engine.
 */

import * as path from "path";
import * as fs from "fs";
import { Project } from "ts-morph";

export const FIXTURES_ROOT = path.resolve(__dirname, "../test-fixtures");

/** Fixture directory constants */
export const FIXTURES = {
  simpleDrill: path.join(FIXTURES_ROOT, "simple-drill"),
  deepDrill: path.join(FIXTURES_ROOT, "deep-drill"),
  spreadBoundary: path.join(FIXTURES_ROOT, "spread-boundary"),
  fanOut: path.join(FIXTURES_ROOT, "fan-out"),
  noDrill: path.join(FIXTURES_ROOT, "no-drill"),
} as const;

/**
 * Create a ts-morph Project and add all .tsx files from the given fixture dir.
 */
export function createFixtureProject(fixtureDir: string): Project {
  const project = new Project({
    compilerOptions: {
      jsx: 4 /* ReactJSX */,
      allowJs: true,
      checkJs: false,
      strict: true,
    },
    skipAddingFilesFromTsConfig: true,
  });

  // Add all TSX files from the fixture dir
  const files = fs.readdirSync(fixtureDir).filter((f: string) => /\.(tsx|ts)$/.test(f));
  for (const file of files) {
    project.addSourceFileAtPath(path.join(fixtureDir, file));
  }

  return project;
}

/** Resolve an absolute path to a fixture file. */
export function fixturePath(dir: string, filename: string): string {
  return path.join(dir, filename);
}
