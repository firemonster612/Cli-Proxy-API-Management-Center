/** The pulsing green dot that marks an attempt running now. */

import styles from './RunningDot.module.scss';

export const RunningDot = () => <span className={styles.dot} aria-hidden="true" />;
