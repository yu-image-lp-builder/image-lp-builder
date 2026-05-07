/**
 * Pre-publish readiness check.
 *
 * Inspects an LP plus the site-wide settings that matter at publish
 * time and returns a categorized list of issues the operator should
 * see before the LP becomes live. Pure function — UI lives in
 * src/components/admin/PrePublishModal.tsx.
 *
 * Severity levels:
 *   - blocker: prevents publish (UI greys out the publish button)
 *   - warning: shown but doesn't block (highly recommended fixes)
 *   - info:    informational, no blocker (e.g. "you set a password")
 *
 * Each issue carries a `jumpTo` so the modal can wire a click to
 * either an in-page anchor (LP-local settings like メタ情報) or an
 * external page (site-wide settings like トラッキングタグ).
 */

import type { PageContent } from './content';

export type CheckSeverity = 'blocker' | 'warning' | 'info';

export type CheckJump =
  | { type: 'anchor'; id: string }
  | { type: 'url'; href: string };

export type CheckIssue = {
  key: string;
  severity: CheckSeverity;
  label: string;
  description?: string;
  jumpTo: CheckJump;
};

export type CheckInput = {
  content: PageContent;
  page: {
    password_hash: string | null;
    publish_at: string | null;
    unpublish_at: string | null;
  };
  /** True when at least one site-wide tracking field is configured. */
  trackingConfigured: boolean;
};

export function checkPublishReadiness(input: CheckInput): CheckIssue[] {
  const { content, page, trackingConfigured } = input;
  const issues: CheckIssue[] = [];
  const now = Date.now();

  // ---- BLOCKERS ------------------------------------------------
  if (content.sections.length === 0) {
    issues.push({
      key: 'no-sections',
      severity: 'blocker',
      label: 'セクションが 0 個です',
      description: '画像セクションを 1 つ以上追加してください。',
      jumpTo: { type: 'anchor', id: 'panel-sections' },
    });
  }

  const totalCtas = content.sections.reduce(
    (sum, s) => sum + (s.ctas?.length ?? 0),
    0
  );
  if (content.sections.length > 0 && totalCtas === 0) {
    issues.push({
      key: 'no-ctas',
      severity: 'blocker',
      label: 'ボタン (CTA) が 1 つもありません',
      description: 'LP 本来の目的である導線(LINE 友だち追加・申込みなど)が無い状態です。',
      jumpTo: { type: 'anchor', id: 'panel-sections' },
    });
  }

  // ---- WARNINGS ------------------------------------------------
  if (!content.meta?.title?.trim()) {
    issues.push({
      key: 'no-meta-title',
      severity: 'warning',
      label: 'ページタイトル(メタ)が未設定',
      description:
        'ブラウザのタブ・SNS シェア・Google 検索結果に出る文言。空のままだと URL の slug が出ます。',
      jumpTo: { type: 'anchor', id: 'panel-meta' },
    });
  }
  if (!content.meta?.description?.trim()) {
    issues.push({
      key: 'no-meta-description',
      severity: 'warning',
      label: 'ページ説明文(メタ)が未設定',
      description: 'SNS シェア・検索結果での 2 行目に出る短い説明。',
      jumpTo: { type: 'anchor', id: 'panel-meta' },
    });
  }
  if (!content.meta?.ogImage?.trim()) {
    issues.push({
      key: 'no-og-image',
      severity: 'warning',
      label: 'OGP 画像が未設定',
      description:
        '無ければ最初のセクションの画像が自動で使われますが、シェア専用画像を指定するとクリック率が上がります。',
      jumpTo: { type: 'anchor', id: 'panel-meta' },
    });
  }

  if (!trackingConfigured) {
    issues.push({
      key: 'no-tracking',
      severity: 'warning',
      label: 'トラッキングタグが未設定(サイト全体)',
      description:
        'GA4 / GTM / Clarity / Meta Pixel が無いと、公開後の流入や CV を一切計測できません。',
      jumpTo: { type: 'url', href: '/admin/site-settings' },
    });
  }

  // ---- INFOS ---------------------------------------------------
  if (page.password_hash) {
    issues.push({
      key: 'password-protected',
      severity: 'info',
      label: 'パスワード保護が有効',
      description:
        '訪問者は最初にパスワード入力を求められます。意図通りなら問題ありません。',
      jumpTo: { type: 'anchor', id: 'panel-publish' },
    });
  }

  if (page.publish_at) {
    const pa = Date.parse(page.publish_at);
    if (Number.isFinite(pa) && pa > now) {
      issues.push({
        key: 'scheduled-future-publish',
        severity: 'info',
        label: '公開開始日時が未来に設定されています',
        description: `${formatLocal(page.publish_at)} まではアクセスしても 404 になります。`,
        jumpTo: { type: 'anchor', id: 'panel-publish' },
      });
    }
  }

  if (page.unpublish_at) {
    const ua = Date.parse(page.unpublish_at);
    if (Number.isFinite(ua) && ua < now) {
      issues.push({
        key: 'unpublish-in-past',
        severity: 'info',
        label: '公開停止日時が過去になっています',
        description:
          '公開しても即座に非公開化されます。停止日時を未来に変更するかクリアしてください。',
        jumpTo: { type: 'anchor', id: 'panel-publish' },
      });
    }
  }

  return issues;
}

export function hasBlockers(issues: CheckIssue[]): boolean {
  return issues.some((i) => i.severity === 'blocker');
}

function formatLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
