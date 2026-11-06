import { type FC, useEffect, useRef, useState } from 'react';
import styles from './index.module.scss';

/**
 * The command that installs the public angular-lynx skill (skills/angular-lynx
 * in the repository) into an AI coding agent, as skills.sh prints it.
 */
const command =
  'npx skills add https://github.com/blotch-smart-frames/angularlynx --skill angular-lynx';

const skillPage =
  'https://www.skills.sh/blotch-smart-frames/angularlynx/angular-lynx';

/**
 * Puts `text` on the clipboard and says whether it got there. The clipboard
 * API needs a secure page, so on an http:// preview, and in older browsers,
 * the old route of copying a selection still does the job.
 */
const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
};

/**
 * A button below the hero that copies the skill's install command, for the
 * reader whose coding agent should know AngularLynx before it writes any.
 * The whole pill is the button, so there's nothing small to aim for; the
 * trailing "Copy" turns into "Copied" for two seconds as the receipt.
 */
export const SkillCommand: FC = () => {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    },
    [],
  );

  const copy = async () => {
    if (!(await copyText(command))) return;
    setCopied(true);
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles['skill']}>
      <button
        type="button"
        className={`${styles['button']} ${copied ? styles['copied'] : ''}`}
        onClick={copy}
        aria-label="Copy the command that installs the AngularLynx skill for an AI coding agent"
      >
        <span className={styles['badge']}>
          <i className="fa-light fa-sparkles" aria-hidden="true" />
          For AI agents
        </span>
        <code className={styles['command']}>{command}</code>
        <span className={styles['copy']}>
          <i
            className={`fa-light ${copied ? 'fa-check' : 'fa-copy'}`}
            aria-hidden="true"
          />
          {copied ? 'Copied' : 'Copy'}
        </span>
      </button>
      {/* The receipt, for a screen reader: the visible "Copied" lives inside a
          labeled button, where it isn't announced. */}
      <span role="status" className={styles['status']}>
        {copied ? 'Copied to the clipboard' : ''}
      </span>
      <p className={styles['caption']}>
        Teaches your AI coding agent how to build with AngularLynx.{' '}
        <a href={skillPage} target="_blank" rel="noreferrer">
          See the skill
          <i className="fa-light fa-arrow-up-right" aria-hidden="true" />
        </a>
      </p>
    </div>
  );
};
