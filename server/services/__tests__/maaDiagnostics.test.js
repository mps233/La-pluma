import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getMaaExecutionDiagnostics, parseForegroundPackage } from '../maaService.js';

describe('getMaaExecutionDiagnostics', () => {
  it('translates unknown drop report failures into one actionable warning', () => {
    const diagnostics = getMaaExecutionDiagnostics(
      '[ERROR] FailedToReportToPenguinStats, UnknownDrops'
    );

    assert.deepEqual(diagnostics, [{
      code: 'UNKNOWN_DROPS',
      level: 'WARN',
      message: '掉落汇报未发送：结算中存在未识别物品，请更新 MaaCore 和资源后重试'
    }]);
  });

  it('distinguishes provider-specific report failures', () => {
    const diagnostics = getMaaExecutionDiagnostics(
      'FailedToReportToPenguinStats\nFailedToReportToYituliu'
    );

    assert.deepEqual(diagnostics.map(item => item.code), [
      'PENGUIN_REPORT_FAILED',
      'YITULIU_REPORT_FAILED'
    ]);
  });

  it('returns no diagnostics for a successful execution', () => {
    assert.deepEqual(getMaaExecutionDiagnostics(''), []);
  });

  it('translates connection and account switching failures', () => {
    const diagnostics = getMaaExecutionDiagnostics(
      'FailedToConnect: device emulator-5554 not found\nSwitch account failed'
    );

    assert.deepEqual(diagnostics.map(item => item.code), [
      'ADB_CONNECTION_FAILED',
      'ACCOUNT_SWITCH_FAILED'
    ]);
  });
});

describe('parseForegroundPackage', () => {
  it('reads the package from the current focus line', () => {
    const output = 'mCurrentFocus=Window{abc u0 com.hypergryph.arknights/com.u8.sdk.U8UnityContext}';
    assert.equal(parseForegroundPackage(output), 'com.hypergryph.arknights');
  });

  it('falls back to the focused app line', () => {
    const output = 'mFocusedApp=ActivityRecord{abc u0 com.android.launcher/com.android.launcher.Main t1}';
    assert.equal(parseForegroundPackage(output), 'com.android.launcher');
  });

  it('returns null when no focused package is available', () => {
    assert.equal(parseForegroundPackage('Window manager state unavailable'), null);
  });
});
