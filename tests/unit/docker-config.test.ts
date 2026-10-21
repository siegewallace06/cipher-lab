import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

const ROOT_DIR = path.resolve(__dirname, '../..');

function readRepoFile(relativePath: string): string {
  const fullPath = path.join(ROOT_DIR, relativePath);
  expect(fs.existsSync(fullPath), `Expected ${relativePath} to exist`).toBe(
    true,
  );
  return fs.readFileSync(fullPath, 'utf8');
}

describe('Docker Local Deployment Configuration', () => {
  describe('Dockerfile & Next.js standalone contract', () => {
    it('configures Next.js standalone output in next.config.ts', () => {
      expect(nextConfig.output).toBe('standalone');
    });

    it('defines a deterministic multi-stage node:20-alpine build with non-root runner', () => {
      const dockerfile = readRepoFile('Dockerfile');

      // Multi-stage node:20-alpine stages
      expect(dockerfile).toMatch(/^FROM\s+node:20-alpine\s+AS\s+deps$/m);
      expect(dockerfile).toMatch(/^FROM\s+node:20-alpine\s+AS\s+builder$/m);
      expect(dockerfile).toMatch(/^FROM\s+node:20-alpine\s+AS\s+runner$/m);

      // Deterministic dependency installation and production build
      expect(dockerfile).toMatch(/^RUN\s+npm\s+ci$/m);
      expect(dockerfile).toMatch(/npm\s+run\s+build/);

      // Required environment variables
      expect(dockerfile).toMatch(/^ENV\s+NODE_ENV=production$/m);
      expect(dockerfile).toMatch(/^ENV\s+NEXT_TELEMETRY_DISABLED=1$/m);
      expect(dockerfile).toMatch(/^ENV\s+PORT=3000$/m);
      expect(dockerfile).toMatch(/^ENV\s+HOSTNAME="0\.0\.0\.0"$/m);

      // Non-root user execution
      const userMatches = [...dockerfile.matchAll(/^USER\s+(\S+)$/gm)];
      expect(userMatches.length).toBeGreaterThan(0);
      const finalUser = userMatches[userMatches.length - 1][1];
      expect(finalUser).not.toBe('root');
      expect(finalUser).not.toBe('0');
      expect(finalUser).toBe('nextjs');

      // Exposed port and entrypoint command
      expect(dockerfile).toMatch(/^EXPOSE\s+3000$/m);
      expect(dockerfile).toMatch(/^CMD\s+\["node",\s*"server\.js"\]$/m);
    });

    it('accounts for every COPY source path in build context or upstream stage outputs', () => {
      const dockerfile = readRepoFile('Dockerfile');
      const dockerignoreLines = readRepoFile('.dockerignore')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));

      const copyLines = dockerfile
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('COPY '));

      expect(copyLines.length).toBeGreaterThan(0);

      // Upstream stage artifacts produced by deps and builder stages
      const producedStagePaths: Record<string, Set<string>> = {
        deps: new Set(['/app/node_modules']),
        builder: new Set([
          '/app/public',
          '/app/.next/standalone',
          '/app/.next/static',
        ]),
      };

      // Verify builder explicitly ensures /app/public exists before runner copies it
      expect(dockerfile).toMatch(/mkdir\s+-p\s+\/app\/public/);

      for (const line of copyLines) {
        const tokens = line
          .replace(/^COPY\s+/, '')
          .split(/\s+/)
          .filter(Boolean);
        const flags = tokens.filter((t) => t.startsWith('--'));
        const pathArgs = tokens.filter((t) => !t.startsWith('--'));

        // Last token is destination; preceding tokens are sources
        expect(pathArgs.length).toBeGreaterThanOrEqual(2);
        const sources = pathArgs.slice(0, -1);
        const fromFlag = flags.find((f) => f.startsWith('--from='));

        if (fromFlag) {
          const stageName = fromFlag.slice('--from='.length);
          const stageOutputs = producedStagePaths[stageName];
          expect(
            stageOutputs,
            `Unknown stage "${stageName}" in "${line}"`,
          ).toBeDefined();
          for (const src of sources) {
            expect(
              stageOutputs.has(src),
              `Stage "${stageName}" must produce source path "${src}" referenced in "${line}"`,
            ).toBe(true);
          }
        } else {
          for (const src of sources) {
            const fullSourcePath = path.join(ROOT_DIR, src);
            expect(
              fs.existsSync(fullSourcePath),
              `Build context source "${src}" in "${line}" must exist in repository`,
            ).toBe(true);
            if (src !== '.') {
              expect(
                dockerignoreLines.includes(src),
                `Build context source "${src}" must not be excluded by .dockerignore`,
              ).toBe(false);
            }
          }
        }
      }
    });
  });

  describe('.dockerignore hygiene', () => {
    it('excludes local artifacts, test outputs, VCS metadata, docs, and secrets while keeping build inputs', () => {
      const dockerignore = readRepoFile('.dockerignore');
      const entries = new Set(
        dockerignore
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith('#')),
      );

      const requiredExclusions = [
        'node_modules',
        '.next',
        'out',
        'dist',
        'coverage',
        'test-results',
        'playwright-report',
        'blob-report',
        'playwright/.cache',
        '.git',
        '.github',
        '.env*',
        '*.log',
        '*.tsbuildinfo',
        '.DS_Store',
        'docs',
      ];

      for (const pattern of requiredExclusions) {
        expect(
          entries.has(pattern),
          `Expected .dockerignore to exclude "${pattern}"`,
        ).toBe(true);
      }

      // Must not exclude files needed by npm ci and npm run build
      const requiredBuildInputs = [
        'package.json',
        'package-lock.json',
        'next.config.ts',
        'tsconfig.json',
        'postcss.config.mjs',
        'src',
      ];
      for (const input of requiredBuildInputs) {
        expect(
          entries.has(input),
          `Expected .dockerignore not to exclude "${input}"`,
        ).toBe(false);
      }
    });
  });

  describe('docker-compose.yml local service definition', () => {
    it('defines the local cipher-lab service on port 3000:3000 with production env and healthcheck', () => {
      const compose = readRepoFile('docker-compose.yml');

      expect(compose).toMatch(/^services:\s*$/m);
      expect(compose).toMatch(/^\s{2}cipher-lab:\s*$/m);
      expect(compose).toMatch(/context:\s*\./);
      expect(compose).toMatch(/dockerfile:\s*Dockerfile/);
      expect(compose).toMatch(/-\s*["']?3000:3000["']?/);
      expect(compose).toMatch(/NODE_ENV:\s*["']?production["']?/);
      expect(compose).toMatch(/NEXT_TELEMETRY_DISABLED:\s*["']?1["']?/);
      expect(compose).toMatch(/PORT:\s*["']?3000["']?/);
      expect(compose).toMatch(/HOSTNAME:\s*["']?0\.0\.0\.0["']?/);
      expect(compose).toMatch(/restart:\s*unless-stopped/);
      expect(compose).toMatch(/healthcheck:/);
      expect(compose).toMatch(/http:\/\/127\.0\.0\.1:3000\//);
    });
  });
});
