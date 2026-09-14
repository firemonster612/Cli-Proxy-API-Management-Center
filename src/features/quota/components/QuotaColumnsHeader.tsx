/**
 * Sticky column header for the board. Shares the row grid (--quota-grid) so
 * each label sits over its column of bars; hidden on phone width where rows
 * stack their cells and name them inline.
 */

import { useTranslation } from 'react-i18next';
import styles from './QuotaColumnsHeader.module.scss';

export function QuotaColumnsHeader() {
  const { t } = useTranslation();
  return (
    <div className={styles.header} role="row" aria-hidden="true">
      <span className={styles.account}>{t('quota_management.col_account')}</span>
      <span className={styles.column}>{t('quota_management.col_five_hour')}</span>
      <span className={styles.column}>{t('quota_management.col_weekly')}</span>
      <span className={styles.column}>{t('quota_management.col_weekly_model')}</span>
      <span className={styles.actions} />
    </div>
  );
}
