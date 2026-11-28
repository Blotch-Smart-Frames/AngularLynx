import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SENTINEL_A, SENTINEL_B } from '@/lib/bench';

// The benchmark's tap screen (benchmarks/SPEC.md, "Tap"), opened by deep link
// (launchperfrn://bench/tap), or at launch in a build with
// EXPO_PUBLIC_BENCH_SCREEN=tap (app/+native-intent.ts). Each tap counts up and
// switches the box between the two sentinel colors, which the probe watches
// for in the native view (benchmarks/harness/probe).
export default function TapScreen() {
  const [taps, setTaps] = useState(0);
  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <View style={[styles.box, { backgroundColor: taps % 2 ? SENTINEL_B : SENTINEL_A }]} />
        <Text style={styles.count}>Taps: {taps}</Text>
      </View>
      <Pressable
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel="Tap"
        onPress={() => setTaps(n => n + 1)}
      >
        <Text style={styles.label}>Tap</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
  top: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    width: 100,
    height: 100,
  },
  count: {
    marginTop: 16,
    fontSize: 20,
    color: '#000',
  },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e3e3e3',
  },
  label: {
    fontSize: 20,
    color: '#000',
  },
});
