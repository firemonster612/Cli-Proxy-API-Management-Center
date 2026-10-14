/**
 * Quota board: provider tabs + a sticky column header + one row per
 * credential with bars aligned in columns.
 *
 * Behavior contracts:
 * - Auto-load: the current page's quotas, plus every account the pool totals,
 *   are fetched when the file list settles, every QUOTA_AUTO_REFRESH_MS, and
 *   when the tab regains focus;
 * - cacheGeneration session isolation + request-id dedupe (useQuotaBatchLoader);
 * - the per-provider quota cache is pruned to files that still exist;
 * - useHeaderRefresh single slot: this page is its only registrant, and a
 *   global refresh re-fetches the file list then the quotas.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi, type InFlightAttempt } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useRevealGroup } from '@/hooks/motion';
import { useAuthStore, useQuotaStore, useThemeStore } from '@/stores';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import { ProviderTabs } from '@/features/authFiles/components/ProviderTabs';
import { QuotaHeader } from './components/QuotaHeader';
import { ActivityOverview } from './components/ActivityOverview';
import { QuotaCard } from './components/QuotaCard';
import { QuotaColumnsHeader } from './components/QuotaColumnsHeader';
import { PoolSummary, type PoolCardData } from './components/PoolSummary';
import {
  CARD_ENTRANCE_BUDGET_MS,
  QUOTA_PAGE_SIZE,
  QUOTA_TAB_ORDER,
  type QuotaTabId,
} from './constants';
import {
  accountLabel,
  buildTabCounts,
  classifyQuotaFiles,
  filterEntriesByTab,
  paginate,
  quotaOrganizationName,
} from './logic';
import type { QuotaFileEntry } from './logic';
import { QUOTA_ADAPTERS, getQuotaSetter, type QuotaCardState } from './providers';
import { hasQuotaColumns } from './columns';
import type { QuotaProviderType } from './providers/types';
import { useBurnPins } from './hooks/useBurnPins';
import { useQuotaActions } from './hooks/useQuotaActions';
import { useQuotaBatchLoader } from './hooks/useQuotaBatchLoader';
import { useInFlightRequests } from './hooks/useInFlightRequests';
import { useRecentRequests } from './hooks/useRecentRequests';
import { useRoutingPreviews } from './hooks/useRoutingPreviews';
import { bankedResetsFor, type BankedResets } from './bankedResets';
import { buildPoolSummary } from './pool';
import {
  accountsByRequestId,
  groupActivityByAccount,
  latestRoutes,
  type RequestLookup,
} from './routing';
import { useNow } from '@/hooks/useNow';
import { readQuotaUiState, writeQuotaUiState } from './uiState';
import styles from './QuotaPage.module.scss';

/** Copies every successful quota into the pool's last-known cache, keyed type:name. */
const withSuccesses = (
  cache: Record<string, QuotaCardState>,
  quotaByType: Record<QuotaProviderType, Record<string, QuotaCardState>>
): Record<string, QuotaCardState> => {
  const next = { ...cache };
  Object.entries(quotaByType).forEach(([type, byName]) =>
    Object.entries(byName).forEach(([name, state]) => {
      if (state.status === 'success') next[`${type}:${name}`] = state;
    })
  );
  return next;
};

const TAB_IDS: string[] = ['all', ...QUOTA_TAB_ORDER];
const SKELETON_CARD_COUNT = 4;
/** Usage windows move slowly; five minutes keeps the board current without churn. */
const QUOTA_AUTO_REFRESH_MS = 5 * 60_000;

const entryKey = (entry: QuotaFileEntry) => `${entry.type}:${entry.file.name}`;
const NO_ATTEMPTS: InFlightAttempt[] = [];

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<QuotaTabId>(() => readQuotaUiState()?.tab ?? 'all');
  const [page, setPage] = useState(1);
  // 页头 + tabs 的入场级联（标题 → meta → 动作 → tabs，级差 70ms）
  const revealRef = useRevealGroup<HTMLDivElement>();

  const disableControls = connectionStatus !== 'connected';

  /* ---------- 文件列表 ---------- */

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useHeaderRefresh(loadFiles);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  /* ---------- 额度缓存 ----------
   * 排在归类/排序之前：「最快恢复优先」要读它算排序键。 */

  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const kimiQuota = useQuotaStore((state) => state.kimiQuota);
  const xaiQuota = useQuotaStore((state) => state.xaiQuota);

  const quotaByType = useMemo<Record<QuotaProviderType, Record<string, QuotaCardState>>>(
    () =>
      ({
        antigravity: antigravityQuota,
        claude: claudeQuota,
        codex: codexQuota,
        kimi: kimiQuota,
        xai: xaiQuota,
      }) as unknown as Record<QuotaProviderType, Record<string, QuotaCardState>>,
    [antigravityQuota, claudeQuota, codexQuota, kimiQuota, xaiQuota]
  );

  const getQuota = useCallback(
    (entry: QuotaFileEntry): QuotaCardState | undefined => quotaByType[entry.type][entry.file.name],
    [quotaByType]
  );

  /* ---------- classify / filter / paginate ---------- */

  const entries = useMemo(() => classifyQuotaFiles(files), [files]);
  const tabCounts = useMemo(() => buildTabCounts(entries), [entries]);
  const filteredEntries = useMemo(() => filterEntriesByTab(entries, tab), [entries, tab]);

  const { pageItems, currentPage, totalPages } = useMemo(
    () => paginate(filteredEntries, page, QUOTA_PAGE_SIZE),
    [filteredEntries, page]
  );

  const handleTabChange = useCallback((next: string) => {
    setTab(next as QuotaTabId);
    setPage(1);
    writeQuotaUiState({ tab: next as QuotaTabId });
  }, []);

  const { loadedCount, attentionCount } = useMemo(() => {
    let loaded = 0;
    let attention = 0;
    entries.forEach((entry) => {
      const status = quotaByType[entry.type][entry.file.name]?.status;
      if (status === 'success') loaded += 1;
      else if (status === 'error') attention += 1;
    });
    return { loadedCount: loaded, attentionCount: attention };
  }, [entries, quotaByType]);

  // 剪枝：文件列表落定后，各 provider 缓存只保留仍存在的凭证
  useEffect(() => {
    if (loading) return;
    const survivorsByType = new Map<QuotaProviderType, Set<string>>(
      QUOTA_TAB_ORDER.map((type) => [type, new Set<string>()])
    );
    entries.forEach((entry) => survivorsByType.get(entry.type)?.add(entry.file.name));

    QUOTA_TAB_ORDER.forEach((type) => {
      const survivors = survivorsByType.get(type) ?? new Set<string>();
      const setQuota = getQuotaSetter(QUOTA_ADAPTERS[type]);
      setQuota((prev) => {
        const staleKeys = Object.keys(prev).filter((name) => !survivors.has(name));
        if (staleKeys.length === 0) return prev;
        const next = { ...prev };
        staleKeys.forEach((name) => delete next[name]);
        return next;
      });
    });
  }, [entries, loading]);

  /* ---------- routing + pool ----------
   * Activity comes from real completed requests and core's in-flight list;
   * "next pick" from core's routing preview for each provider on the board.
   * The pool aggregates every account of the providers it shows, not just
   * the visible page. */

  const now = useNow();
  const { enabled: historyEnabled, requests } = useRecentRequests(!disableControls);
  const inFlight = useInFlightRequests(!disableControls);
  const shownProviders = useMemo(
    () => [...new Set(filteredEntries.map((entry) => entry.type))],
    [filteredEntries]
  );
  const previews = useRoutingPreviews(shownProviders, !disableControls);

  const entryByAuth = useMemo(
    () => new Map(entries.map((entry) => [String(entry.file.authIndex ?? ''), entry])),
    [entries]
  );
  const providerOf = useCallback(
    (authIndex: string) => entryByAuth.get(authIndex)?.type,
    [entryByAuth]
  );
  const lookup = useMemo<RequestLookup>(
    () => ({
      accountsByRequest: accountsByRequestId(requests),
      labelOf: (authIndex) => {
        const entry = entryByAuth.get(authIndex);
        return entry ? accountLabel(entry.file) : authIndex;
      },
    }),
    [requests, entryByAuth]
  );
  const activityByAuth = useMemo(() => groupActivityByAccount(requests, now), [requests, now]);
  const routes = useMemo(() => latestRoutes(activityByAuth, providerOf), [activityByAuth, providerOf]);
  const inFlightByAuth = useMemo(() => {
    const byAuth = new Map<string, InFlightAttempt[]>();
    inFlight?.attempts.forEach((attempt) =>
      byAuth.set(attempt.authIndex, [...(byAuth.get(attempt.authIndex) ?? []), attempt])
    );
    return byAuth;
  }, [inFlight]);
  const exclusionByAuth = useMemo(
    () =>
      new Map(
        [...previews.values()].flatMap((preview) =>
          preview.excluded.map((exclusion) => [exclusion.authIndex, exclusion] as const)
        )
      ),
    [previews]
  );
  const [openDetails, setOpenDetails] = useState<Set<string>>(() => new Set());
  const toggleDetails = useCallback((key: string) => {
    setOpenDetails((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  // The pool keeps each account's last loaded quota while a refresh is in
  // flight, so the totals don't drop out and flicker on every reload.
  // Updated during render (React's "storing information from previous renders").
  const [settledQuota, setSettledQuota] = useState(() => withSuccesses({}, quotaByType));
  const [settledFrom, setSettledFrom] = useState(quotaByType);
  if (settledFrom !== quotaByType) {
    setSettledFrom(quotaByType);
    setSettledQuota((prev) => withSuccesses(prev, quotaByType));
  }
  const getPoolQuota = useCallback(
    (entry: QuotaFileEntry): QuotaCardState | undefined => {
      const current = getQuota(entry);
      return current?.status === 'loading'
        ? (settledQuota[`${entry.type}:${entry.file.name}`] ?? current)
        : current;
    },
    [getQuota, settledQuota]
  );

  const poolEntries = useMemo(
    () => filteredEntries.filter((entry) => hasQuotaColumns(entry.type)),
    [filteredEntries]
  );

  const poolCards = useMemo<PoolCardData[]>(() => {
    const providers = tab === 'all' ? QUOTA_TAB_ORDER : [tab];
    return providers.flatMap((provider) => {
      const providerEntries = poolEntries.filter((entry) => entry.type === provider);
      const summary = buildPoolSummary(
        provider,
        providerEntries.map((entry) => ({
          key: entry.file.name,
          label: accountLabel(entry.file),
          authIndex: String(entry.file.authIndex ?? ''),
          type: entry.type,
          quota: getPoolQuota(entry),
          organizationName: quotaOrganizationName(entry.type, getPoolQuota(entry)),
        })),
        now
      );
      if (!summary || summary.accounts.length + summary.monthlyCount === 0) return [];
      const route = routes.get(provider);
      const preview = previews.get(provider);
      const banked = providerEntries
        .map((entry) => bankedResetsFor(entry.type, getPoolQuota(entry)))
        .filter((value): value is BankedResets => value !== null);
      return [
        {
          summary,
          route,
          routeLabel: route ? lookup.labelOf(route.authIndex) : null,
          preview,
          previewLabel: preview?.chosenAuthIndex ? lookup.labelOf(preview.chosenAuthIndex) : null,
          banked,
        },
      ];
    });
  }, [getPoolQuota, lookup, now, poolEntries, previews, routes, tab]);

  /* ---------- 加载与操作 ---------- */

  const { batchLoading, loadQuota } = useQuotaBatchLoader();
  const { resettingQuotaName, refreshQuota, resetQuota } = useQuotaActions(disableControls);
  const { pins, pinFor, burn, stopBurning, busyAuthIndex } = useBurnPins(!disableControls);

  // Refresh all: re-fetch the file list, then the quotas once it settles.
  const handleRefreshAll = useCallback(() => {
    if (disableControls) return;
    void loadFiles();
  }, [disableControls, loadFiles]);

  /* ---------- auto-load ----------
   * Targets are the rows on screen plus every pool account. After the file
   * list (re)loads (first load, refresh-all) they are all fetched. When the
   * target set changes (tab, page), only accounts with no quota yet are
   * fetched, so paging doesn't refetch the whole pool; that check re-runs
   * once an in-flight batch finishes, because the loader drops overlapping
   * runs. A timer and tab focus keep everything fresh. */
  const loadTargets = useMemo(() => {
    const onPage = new Set(pageItems.map(entryKey));
    return [...pageItems, ...poolEntries.filter((entry) => !onPage.has(entryKey(entry)))];
  }, [pageItems, poolEntries]);
  const loadTargetsRef = useRef(loadTargets);
  useEffect(() => {
    loadTargetsRef.current = loadTargets;
  }, [loadTargets]);

  useEffect(() => {
    if (loading || disableControls) return;
    void loadQuota(loadTargetsRef.current);
  }, [loading, disableControls, loadQuota]);

  useEffect(() => {
    if (loading || disableControls || batchLoading) return;
    const missing = loadTargets.filter((entry) => {
      const status = getQuota(entry)?.status;
      return status === undefined || status === 'idle';
    });
    void loadQuota(missing);
  }, [loading, disableControls, batchLoading, loadTargets, getQuota, loadQuota]);

  useEffect(() => {
    if (disableControls) return;
    const refetch = () => {
      if (document.visibilityState !== 'visible') return;
      void loadQuota(loadTargetsRef.current);
    };
    const timer = setInterval(refetch, QUOTA_AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', refetch);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refetch);
    };
  }, [disableControls, loadQuota]);

  const canUseActions = !disableControls && !loading;

  /* ---------- 首屏卡片一次性级联入场 ----------
   * 首批数据渲染后立即翻转 cardsAnimated；已挂载的卡片在挂载时捕获过自己的
   * 延迟（QuotaCard 内 useState 初始化），后续切 tab/翻页/刷新新挂载的卡片
   * 拿到 null —— 不重播。 */

  const [cardsAnimated, setCardsAnimated] = useState(false);
  const enableCardEntrance = !cardsAnimated && !loading && pageItems.length > 0;
  useEffect(() => {
    if (enableCardEntrance) {
      setCardsAnimated(true);
    }
  }, [enableCardEntrance]);
  const cardEntranceDelay = (index: number): number | null => {
    if (!enableCardEntrance) return null;
    if (pageItems.length <= 1) return 0;
    return Math.round((index / (pageItems.length - 1)) * CARD_ENTRANCE_BUDGET_MS);
  };

  /* ---------- 渲染 ---------- */

  const isEmpty = !loading && filteredEntries.length === 0;

  return (
    <div className={styles.page} ref={revealRef}>
      <QuotaHeader
        totalCount={entries.length}
        loadedCount={loadedCount}
        attentionCount={attentionCount}
        burningCount={pins.length}
        refreshing={loading || batchLoading}
        disableControls={disableControls}
        onRefreshAll={handleRefreshAll}
      />

      {!loading && (
        <PoolSummary
          cards={poolCards}
          historyEnabled={historyEnabled}
          resolvedTheme={resolvedTheme}
        />
      )}

      {!loading && (
        <ActivityOverview
          requests={requests}
          inFlight={inFlight}
          lookup={lookup}
          providerOf={providerOf}
          historyEnabled={historyEnabled}
          resolvedTheme={resolvedTheme}
        />
      )}

      <section className={styles.workbench}>
        <div className={styles.tabsRow} data-reveal>
          <ProviderTabs
            types={TAB_IDS}
            counts={tabCounts}
            active={tab}
            resolvedTheme={resolvedTheme}
            onChange={handleTabChange}
          />
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className={styles.list} aria-hidden="true">
            {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
              <div key={index} className={styles.skeletonRow}>
                <Skeleton height={40} rounded={6} />
              </div>
            ))}
          </div>
        ) : isEmpty ? (
          <EmptyState
            title={
              tab === 'all'
                ? t('quota_management.empty_title')
                : t(`${QUOTA_ADAPTERS[tab].i18nPrefix}.empty_title`)
            }
            description={
              tab === 'all'
                ? t('quota_management.empty_desc')
                : t(`${QUOTA_ADAPTERS[tab].i18nPrefix}.empty_desc`)
            }
            action={
              tab === 'all' ? undefined : (
                <Button variant="secondary" size="sm" onClick={() => handleTabChange('all')}>
                  {t('auth_files.filter_all')}
                </Button>
              )
            }
          />
        ) : (
          <div className={styles.list}>
            <QuotaColumnsHeader />
            {pageItems.map((entry, index) => {
              const key = entryKey(entry);
              const authIndex = String(entry.file.authIndex ?? '');
              return (
                <QuotaCard
                  key={key}
                  entry={entry}
                  resolvedTheme={resolvedTheme}
                  routing={{
                    activity: activityByAuth.get(authIndex),
                    inFlight: inFlightByAuth.get(authIndex) ?? NO_ATTEMPTS,
                    observedAtMs: inFlight?.observedAtMs ?? now,
                    latestRoute: routes.get(entry.type)?.authIndex === authIndex,
                    nextPick: previews.get(entry.type)?.chosenAuthIndex === authIndex,
                    exclusion: exclusionByAuth.get(authIndex),
                  }}
                  lookup={lookup}
                  historyEnabled={historyEnabled}
                  detailsOpen={openDetails.has(key)}
                  onToggleDetails={() => toggleDetails(key)}
                  quota={getQuota(entry)}
                  pin={pinFor(entry.file)}
                  canRefresh={canUseActions && !entry.file.disabled}
                  resetting={resettingQuotaName === entry.file.name}
                  burnBusy={
                    disableControls ||
                    (busyAuthIndex !== null && busyAuthIndex === String(entry.file.authIndex ?? ''))
                  }
                  entranceDelayMs={cardEntranceDelay(index)}
                  onRefresh={() => void refreshQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
                  onReset={() => resetQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
                  onBurn={(choice) => void burn(entry.file, choice)}
                  onStopBurning={() => void stopBurning(entry.file)}
                />
              );
            })}
          </div>
        )}

        {!loading && filteredEntries.length > QUOTA_PAGE_SIZE && (
          <div className={styles.pagination}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
            >
              {t('auth_files.pagination_prev')}
            </Button>
            <div className={styles.pageInfo}>
              {t('auth_files.pagination_info', {
                current: currentPage,
                total: totalPages,
                count: filteredEntries.length,
              })}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
            >
              {t('auth_files.pagination_next')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
