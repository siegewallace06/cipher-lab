import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];

test.describe('Cipher Lab Workbench E2E Suite', () => {
  test('renders across 320px, 768px, 1366px, and 1920px viewports with zero horizontal overflow, zero external network calls, and passes WCAG AA axe scan in dark & light themes', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const externalRequests: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });
    page.on('request', (req) => {
      const url = req.url();
      if (
        (url.startsWith('http://') || url.startsWith('https://')) &&
        !url.startsWith('http://127.0.0.1') &&
        !url.startsWith('http://localhost')
      ) {
        externalRequests.push(url);
      }
    });

    await page.goto('/');
    await expect(page.getByTestId('workbench-toolbar')).toBeVisible();

    const desktopViewports = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 900 },
      { width: 1240, height: 900 },
    ];

    for (const vp of desktopViewports) {
      await page.setViewportSize(vp);
      await expect(page.getByTestId('desktop-catalog-column')).toBeVisible();
      await expect(page.getByTestId('pipeline-column')).toBeVisible();
      await expect(page.getByTestId('data-column')).toBeVisible();
      await expect(
        page.getByTestId('pipeline-open-catalog-btn'),
      ).not.toBeVisible();

      const desktopLayout = await page.evaluate(() => {
        const cat = document.querySelector(
          '[data-testid="desktop-catalog-column"]',
        )!;
        const pipe = document.querySelector('[data-testid="pipeline-column"]')!;
        const data = document.querySelector('[data-testid="data-column"]')!;
        return {
          overflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
          catTop: cat.getBoundingClientRect().top,
          pipeTop: pipe.getBoundingClientRect().top,
          dataTop: data.getBoundingClientRect().top,
          catGridColumn: getComputedStyle(cat).gridColumn,
          pipeGridColumn: getComputedStyle(pipe).gridColumn,
          dataGridColumn: getComputedStyle(data).gridColumn,
        };
      });

      expect(
        desktopLayout.overflow,
        `No horizontal overflow at ${vp.width}x${vp.height}`,
      ).toBe(false);
      expect(desktopLayout.catGridColumn).toBe('span 3 / span 3');
      expect(desktopLayout.pipeGridColumn).toBe('span 4 / span 4');
      expect(desktopLayout.dataGridColumn).toBe('span 5 / span 5');
      expect(
        Math.abs(desktopLayout.catTop - desktopLayout.pipeTop),
      ).toBeLessThanOrEqual(2);
      expect(
        Math.abs(desktopLayout.pipeTop - desktopLayout.dataTop),
      ).toBeLessThanOrEqual(2);
    }

    // Verify tablet 2-column grid layout at 768x1024
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.getByTestId('pipeline-column')).toBeVisible();
    await expect(page.getByTestId('data-column')).toBeVisible();
    await expect(page.getByTestId('pipeline-open-catalog-btn')).toBeVisible();
    const tabletLayout = await page.evaluate(() => {
      const pipe = document.querySelector('[data-testid="pipeline-column"]')!;
      const data = document.querySelector('[data-testid="data-column"]')!;
      return {
        overflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
        pipeTop: pipe.getBoundingClientRect().top,
        dataTop: data.getBoundingClientRect().top,
        pipeGridColumn: getComputedStyle(pipe).gridColumn,
        dataGridColumn: getComputedStyle(data).gridColumn,
      };
    });
    expect(tabletLayout.overflow, 'No horizontal overflow at 768x1024').toBe(
      false,
    );
    expect(tabletLayout.pipeGridColumn).toBe('span 5 / span 5');
    expect(tabletLayout.dataGridColumn).toBe('span 7 / span 7');
    expect(
      Math.abs(tabletLayout.pipeTop - tabletLayout.dataTop),
    ).toBeLessThanOrEqual(2);

    // Verify mobile layout at 320x720
    await page.setViewportSize({ width: 320, height: 720 });
    const mobileOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(mobileOverflow, 'No horizontal overflow at 320x720').toBe(false);

    // Restore desktop viewport for theme & axe checks
    await page.setViewportSize({ width: 1366, height: 900 });

    // Switch to dark theme and run axe WCAG 2.2 AA scan
    await page.getByTestId('toolbar-theme-select').selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const darkAxe = await new AxeBuilder({ page: page as unknown as AxePage })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(darkAxe.violations).toEqual([]);

    // Switch to light theme and run axe WCAG 2.2 AA scan
    await page.getByTestId('toolbar-theme-select').selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const lightAxe = await new AxeBuilder({ page: page as unknown as AxePage })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(lightAxe.violations).toEqual([]);

    // Verify localStorage only stores cipher-lab-theme
    const storageKeys = await page.evaluate(() => ({
      local: Object.keys(window.localStorage),
      session: Object.keys(window.sessionStorage),
    }));
    expect(storageKeys.local).toEqual(['cipher-lab-theme']);
    expect(storageKeys.session).toEqual([]);
    expect(externalRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('executes multi-step pipeline, step controls, intermediate inspector, entropy chart, and binary hex input', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/');

    // Load neutral sample input ("Hello, Cipher Lab!")
    await page.getByTestId('input-sample-btn').click();
    await expect(page.getByTestId('input-textarea')).toHaveValue(
      'Hello, Cipher Lab!',
    );

    // Filter catalog and add Base64 + URL + Entropy steps
    await page.getByTestId('catalog-search-input').fill('base64');
    await page.getByTestId('add-op-base64').click();
    await page.getByTestId('catalog-search-clear').click();

    await page.getByTestId('add-op-url').click();
    await page.getByTestId('add-op-entropy').click();

    await expect(page.getByTestId('pipeline-step-count')).toContainText(
      '3/32',
    );

    // Wait for output to reflect Entropy report on the Base64+URL transformed payload
    await expect(page.getByTestId('output-text-view')).toContainText(
      'entropyBitsPerByte',
    );

    // First added step (Base64) is selected by default; verify intermediate output "SGVsbG8sIENpcGhlciBMYWIh"
    const stepCards = page.locator('[data-testid^="step-card-"]');
    await expect(stepCards).toHaveCount(3);
    await expect(page.getByTestId('step-inspector')).toBeVisible();
    await expect(page.getByTestId('inspector-text-view')).toHaveText(
      'SGVsbG8sIENpcGhlciBMYWIh',
    );

    // Switch inspector to Hex view
    await page.getByTestId('inspector-view-hex').click();
    await expect(page.getByTestId('inspector-hex-view')).toContainText('53 47');

    // Inspect the third step (Entropy) to verify visual frequency chart
    const thirdStepTestId = await stepCards.nth(2).getAttribute('data-testid');
    const thirdStepId = thirdStepTestId!.replace('step-card-', '');
    await page.getByTestId(`step-inspect-${thirdStepId}`).click();
    await expect(page.getByTestId('inspector-entropy-chart')).toBeVisible();

    // Bypass the Entropy step so final output becomes URL-encoded Base64 string
    await page.getByTestId(`step-toggle-${thirdStepId}`).click();
    await expect(page.getByTestId('output-text-view')).toHaveText(
      'SGVsbG8sIENpcGhlciBMYWIh',
    );

    // Test binary hex entry mode (non-UTF-8 bytes: 00 ff 80 7f)
    await page.getByTestId('toolbar-clear-btn').click();
    await page.getByTestId('input-entry-hex').click();
    await page.getByTestId('input-textarea').fill('00 ff 80 7f');
    await page.getByTestId('add-op-hex').click();
    await expect(page.getByTestId('output-text-view')).toHaveText(
      '00ff807f',
    );

    // Verify JSON step large-integer precision warning in Inspector
    await page.getByTestId('toolbar-clear-btn').click();
    await page
      .getByTestId('input-textarea')
      .fill('{"id": 9007199254740993}');
    await page.getByTestId('add-op-json').click();
    await expect(
      page.getByTestId('inspector-json-precision-warning'),
    ).toBeVisible();
  });

  test('supports format detection quick-apply, starter presets with confirmation, and #cl= URL sharing with secret stripping', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/');

    // Enter Base64 encoded string and verify detection banner suggests Base64 decode
    await page
      .getByTestId('input-textarea')
      .fill('SGVsbG8sIENpcGhlciBMYWIh');
    await expect(page.getByTestId('input-detection-banner')).toBeVisible();
    await page.getByTestId('input-detection-apply-base64').click();
    await expect(page.getByTestId('output-text-view')).toHaveText(
      'Hello, Cipher Lab!',
    );

    // Load AES-256-GCM Encrypt -> Decrypt preset (requires confirmation since workspace is non-empty)
    await page
      .getByTestId('toolbar-preset-select')
      .selectOption('aes-encrypt-decrypt');
    await page.getByTestId('toolbar-load-preset-btn').click();
    await expect(page.getByTestId('preset-confirm-accept-btn')).toBeVisible();
    await page.getByTestId('preset-confirm-accept-btn').click();

    // Verify demo passphrase warning banner and round-trip decrypted output
    await expect(page.getByTestId('preset-demo-secret-notice')).toBeVisible();
    await expect(page.getByTestId('output-text-view')).toHaveText(
      'Hello, Cipher Lab!',
      { timeout: 15_000 },
    );

    // Open Share URL modal and verify both AES passphrases are listed as omitted secrets
    await page.getByTestId('toolbar-share-btn').click();
    await expect(page.getByTestId('share-omitted-secrets-list')).toBeVisible();
    await page.getByTestId('share-include-input-checkbox').check();
    const sharedUrl = await page.getByTestId('share-url-output').inputValue();
    expect(sharedUrl).toContain('#cl=');
    expect(sharedUrl).not.toContain('demo-passphrase-not-for-production');

    // Navigate to a fresh page with the shared #cl= fragment
    const hashIndex = sharedUrl.indexOf('#cl=');
    const fragment = sharedUrl.slice(hashIndex);
    await page.goto(`/${fragment}`);

    // Verify auto-run is paused on import and missing secrets notice is displayed
    await expect(page.getByTestId('restore-notice-banner')).toBeVisible();
    await expect(
      page.getByTestId('restore-missing-secrets-warning'),
    ).toBeVisible();

    // Navigate to a malformed #cl= fragment and verify error banner
    await page.goto('/#cl=invalid_base64_payload===');
    await expect(page.getByTestId('import-error-banner')).toBeVisible();
  });

  test('renders untrusted HTML/SVG/script payloads strictly as inert text', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/');

    const xssPayload =
      '<script>window.__xssExecuted = true;</script><img src=x onerror="window.__xssExecuted = true"><svg onload="window.__xssExecuted = true">';
    await page.getByTestId('input-textarea').fill(xssPayload);
    await expect(page.getByTestId('output-text-view')).toHaveText(xssPayload);

    const xssFlag = await page.evaluate(
      () => (window as unknown as { __xssExecuted?: boolean }).__xssExecuted,
    );
    expect(xssFlag).toBeUndefined();
  });
});
