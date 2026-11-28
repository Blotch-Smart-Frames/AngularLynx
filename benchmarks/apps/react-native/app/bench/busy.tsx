import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SENTINEL_A, SENTINEL_B, SENTINEL_MOVER } from '@/lib/bench';

// The benchmark's busy screen (benchmarks/SPEC.md, "Busy"), opened by deep
// link (launchperfrn://bench/busy), or at launch in a build with
// EXPO_PUBLIC_BENCH_SCREEN=busy (app/+native-intent.ts). The tap screen, with
// a box moving across the top, and a handler that works for 50 ms before it
// counts the tap. The box moves with Animated's native driver, React Native's
// usual way to keep an animation off the JavaScript thread.

/** 50 ms of the JavaScript thread doing nothing else. */
const work = () => {
  const end = Date.now() + 50;
  while (Date.now() < end) {
    // Busy on purpose.
  }
};

export default function BusyScreen() {
  const [taps, setTaps] = useState(0);
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;

  // From 0 to 300 px and back, 1 s each way, linear: the Lynx apps' CSS
  // animation (`move 1s linear infinite alternate`). One 2 s timing mapped
  // there and back, not a sequence of two: the native driver starts each
  // animation of a sequence on the value the last one ended on, so the box
  // showed 300 px for two frames at every turn, a stall the probe counted
  // that a CSS animation doesn't have.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);
  const x = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 300, 0] });

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.track}>
        <Animated.View style={[styles.mover, { transform: [{ translateX: x }] }]} />
      </View>
      <View style={styles.top}>
        <View style={[styles.box, { backgroundColor: taps % 2 ? SENTINEL_B : SENTINEL_A }]} />
        <Text style={styles.count}>Taps: {taps}</Text>
      </View>
      <Pressable
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel="Busy"
        onPress={() => {
          work();
          setTaps(n => n + 1);
        }}
      >
        <Text style={styles.label}>Busy</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
  track: {
    height: 40,
  },
  mover: {
    width: 40,
    height: 40,
    backgroundColor: SENTINEL_MOVER,
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
    height: '50%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e3e3e3',
  },
  label: {
    fontSize: 20,
    color: '#000',
  },
});
