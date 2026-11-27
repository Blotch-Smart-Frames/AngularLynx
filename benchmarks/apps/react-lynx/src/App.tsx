import { useEffect, useState } from '@lynx-js/react';
import { QueryClientProvider } from '@tanstack/react-query';

import './App.css';
import { TabBar } from './components/TabBar';
import { queryClient } from './lib/queryClient';
import { shell } from './lib/shell';
import { useNavigation } from './navigation';
import BenchBusy from './screens/BenchBusy';
import BenchMount from './screens/BenchMount';
import BenchTap from './screens/BenchTap';
import BenchUpdate from './screens/BenchUpdate';
import Favourites from './screens/Favourites';
import Index from './screens/Index';
import PokemonScreen from './screens/PokemonScreen';

/**
 * A BENCH_SCREEN build's screen and its query, e.g. `mount?kind=view&count=1500`
 * (lynx.config.ts). Parsed by hand: URLSearchParams isn't on Lynx's threads.
 */
const parseBenchScreen = (value: string) => {
  if (!value) return null;
  const [name = '', query = ''] = value.split('?');
  const params: Record<string, string> = {};
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const [key = '', param = ''] = pair.split('=');
    params[decodeURIComponent(key)] = decodeURIComponent(param);
  }
  return { name, params };
};

const benchScreen = parseBenchScreen(process.env.BENCH_SCREEN);

export function App() {
  // The shell keeps a copy of the launch screen over the page until the app
  // says its first screen is drawn, as AngularLynx's LynxSplashScreen does
  // after its first flush. ReactLynx's first screen is drawn by the main
  // thread before this runs, so the first effect is that moment. The
  // original's equivalent is its TTID report from the root layout.
  useEffect(() => {
    shell().AngularLynxShell?.hideSplashScreen();
  }, []);

  if (benchScreen?.name === 'mount') {
    return <BenchMount params={benchScreen.params} />;
  }
  if (benchScreen?.name === 'tap') {
    return <BenchTap params={benchScreen.params} />;
  }
  if (benchScreen?.name === 'update') {
    return <BenchUpdate params={benchScreen.params} />;
  }
  if (benchScreen?.name === 'busy') {
    return <BenchBusy params={benchScreen.params} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Tabs />
    </QueryClientProvider>
  );
}

function Tabs() {
  const tab = useNavigation(state => state.tab);
  const detailId = useNavigation(state => state.detailId);
  // React Navigation's tabs mount a screen the first time it's shown and
  // keep it mounted after, hidden while another tab is shown.
  const [favouritesMounted, setFavouritesMounted] = useState(false);
  if (tab === 'favourites' && !favouritesMounted) {
    setFavouritesMounted(true);
  }

  return (
    <view className="app">
      <view className="screens">
        <view className="fill" style={tab === 'index' ? undefined : { display: 'none' }}>
          <Index />
        </view>
        {(favouritesMounted || tab === 'favourites') && (
          <view className="fill" style={tab === 'favourites' ? undefined : { display: 'none' }}>
            <Favourites />
          </view>
        )}
      </view>
      <TabBar />
      {detailId && <PokemonScreen key={detailId} id={detailId} />}
    </view>
  );
}
