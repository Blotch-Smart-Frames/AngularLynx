import { useEffect, useState, useCallback } from 'react';
import { HomeLayout as BaseHomeLayout } from '@rspress/core/theme-original';
import {
  Banner,
  Compare,
  Features,
  MeteorsBackground,
  ShowCase,
} from '../src/components/home-comps';

import './index.scss';

const cyclingWords = ['Build', 'Ship', 'Test'];

const HeroCommandBox = () => {
  const [copied, setCopied] = useState(false);

  const copyCommand = useCallback(() => {
    navigator.clipboard.writeText('npm create angular-lynx my-app').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  return (
    <div className="hero-command-box">
      <button
        type="button"
        className={`hero-command-box__cmd ${copied ? 'copied' : ''}`}
        onClick={copyCommand}
        aria-label="Copy command"
      >
        <span className="prompt">$</span>
        <span className="text">npm create angular-lynx my-app</span>
        <span className="icon" aria-hidden="true">
          <i className={`fa-light ${copied ? 'fa-check' : 'fa-copy'}`} />
        </span>
      </button>
    </div>
  );
};

/**
 * Poll with rAF until `selector` matches, then call `cb`. Gives up after 5 s.
 */
const whenReady = (
  selector: string,
  cb: (el: Element) => void,
): (() => void) => {
  let canceled = false;
  let rafId: number;
  let attempts = 0;
  const maxAttempts = 300;

  const poll = () => {
    if (canceled || ++attempts > maxAttempts) return;
    const el = document.querySelector(selector);
    if (el) {
      cb(el);
    } else {
      rafId = requestAnimationFrame(poll);
    }
  };

  rafId = requestAnimationFrame(poll);
  return () => {
    canceled = true;
    cancelAnimationFrame(rafId);
  };
};

const HomeLayout = (props: Parameters<typeof BaseHomeLayout>[0]) => {
  useEffect(() => {
    const clean = whenReady(
      '.rspress-home-hero-tagline, .rp-home-hero__tagline',
      (tagline) => {
        if (tagline.textContent?.includes('Lynx')) {
          tagline.innerHTML = tagline.innerHTML
            .replace(
              'Lynx',
              '<a href="https://lynxjs.org" target="_blank" rel="noreferrer">Lynx</a>',
            )
            .replace(
              'Angular',
              '<a href="https://angular.dev" target="_blank" rel="noreferrer">Angular</a>',
            );
        }
      },
    );
    return clean;
  }, []);

  useEffect(() => {
    let wordIndex = 0;
    let text = cyclingWords[0];
    let deleting = false;
    let paused = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let canceled = false;
    let cachedEl: Element | null = null;

    const schedule = (delay: number) => {
      if (!canceled) timerId = setTimeout(tick, delay);
    };

    const tick = () => {
      if (!cachedEl || !cachedEl.isConnected) {
        cachedEl = document.querySelector('.hero-title .dynamic-text');
      }
      if (!cachedEl) return schedule(200);

      const word = cyclingWords[wordIndex];

      if (!deleting && text === word) {
        if (!paused) {
          paused = true;
          schedule(1000);
        } else {
          paused = false;
          deleting = true;
          schedule(100);
        }
      } else if (deleting) {
        text = word.substring(0, text.length - 1);
        cachedEl.textContent = text;
        if (text === '') {
          deleting = false;
          wordIndex = (wordIndex + 1) % cyclingWords.length;
          schedule(140);
        } else {
          schedule(100);
        }
      } else {
        text = cyclingWords[wordIndex].substring(0, text.length + 1);
        cachedEl.textContent = text;
        schedule(200);
      }
    };

    schedule(1000);

    return () => {
      canceled = true;
      if (timerId !== null) clearTimeout(timerId);
    };
  }, []);

  const {
    afterHero = (
      <>
        <Features />
        <ShowCase />
        <Compare />
        <Banner />
      </>
    ),
    afterHeroActions = <HeroCommandBox />,
  } = props;

  return (
    <>
      <MeteorsBackground gridSize={120} meteorCount={5} />
      <div className="home-layout-container">
        <BaseHomeLayout
          {...props}
          afterHero={afterHero}
          afterHeroActions={afterHeroActions}
        />
      </div>
    </>
  );
};

export { HomeLayout };

// Font Awesome replacements for Rspress's icons. They must be named exports:
// a named export shadows the same name in the `export *` below, whereas a
// second `export *` would make each name ambiguous and export neither.
export {
  IconArrowDown,
  IconArrowRight,
  IconClose,
  IconCopy,
  IconDeprecated,
  IconDown,
  IconEdit,
  IconEmpty,
  IconExperimental,
  IconExternalLink,
  IconFile,
  IconGithub,
  IconGitlab,
  IconHeader,
  IconJump,
  IconLink,
  IconLoading,
  IconMenu,
  IconMoon,
  IconScrollToTop,
  IconSearch,
  IconSmallMenu,
  IconSuccess,
  IconSun,
  IconTitle,
  IconWrap,
  IconWrapped,
} from './icons';

export * from '@rspress/core/theme-original';
