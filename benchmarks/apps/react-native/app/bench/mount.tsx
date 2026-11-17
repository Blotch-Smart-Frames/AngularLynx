import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/colors';
import { SPRITE_BASE } from '@/lib/mappers/pokemon';
import { reportFullyDrawn, reportMountEnd, reportMountStart } from '@/modules/app-startup-module';

// The benchmark's rendering-throughput screen (benchmarks/SPEC.md, "Mount"),
// opened by deep link (launchperfrn://bench/mount?kind=view&count=1500), or at
// launch in a build with EXPO_PUBLIC_BENCH_SCREEN (app/+native-intent.ts).
type Kind = 'view' | 'text' | 'image';

type MountParams = {
  kind?: string;
  count?: string;
};

const KINDS: readonly Kind[] = ['view', 'text', 'image'];

export default function MountScreen() {
  // Called while the screen renders, before React builds its children, so
  // the mark brackets the whole mount. The native module emits each name once
  // per process, so a re-render can't move it.
  reportMountStart();

  const params = useLocalSearchParams<MountParams>();
  const kind: Kind = KINDS.includes(params.kind as Kind) ? (params.kind as Kind) : 'view';
  const count = Number(params.count) > 0 ? Number(params.count) : 1500;
  const insets = useSafeAreaInsets();

  // Reported the way the Pokédex reports TTFD: after the commit, on the next
  // frame, so the elements are on screen rather than just created. A
  // BENCH_SCREEN build launches here, so this is its fully drawn (the list
  // never renders in that build to report its own).
  useEffect(() => {
    requestAnimationFrame(() => {
      reportMountEnd();
      reportFullyDrawn();
    });
  }, []);

  const items = [];
  for (let i = 0; i < count; i++) {
    items.push(<Item key={i} kind={kind} index={i} />);
  }

  return (
    // A ScrollView renders every child (it isn't virtualized), so all `count`
    // elements mount, and the ones past the screen can still be scrolled to.
    <ScrollView
      style={[styles.screen, { paddingTop: insets.top }]}
      contentContainerStyle={styles.container}
    >
      {items}
    </ScrollView>
  );
}

function Item({ kind, index }: { kind: Kind; index: number }) {
  switch (kind) {
    case 'text':
      return <Text>{index}</Text>;
    case 'image':
      // expo-image, as the Pokédex's rows draw their sprites.
      return (
        <Image
          source={`${SPRITE_BASE}/${(index % 300) + 1}.png`}
          style={styles.image}
          contentFit="contain"
        />
      );
    default:
      return <View style={styles.box} />;
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  box: {
    width: 10,
    height: 10,
    backgroundColor: Colors.textPrimary,
  },
  image: {
    width: 24,
    height: 24,
  },
});
