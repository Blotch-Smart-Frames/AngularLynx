import { useLocalSearchParams } from 'expo-router';
import { memo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SENTINEL_A, SENTINEL_B } from '@/lib/bench';

// The benchmark's partial-update screen (benchmarks/SPEC.md, "Update"),
// opened by deep link (launchperfrn://bench/update?rows=1000), or at launch in
// a build with EXPO_PUBLIC_BENCH_SCREEN=update (app/+native-intent.ts): `rows`
// rows of a box and two texts in a plain ScrollView, so every row mounts,
// over three buttons that change one row, every 10th row, or every row.

const BUTTONS = [
  { every: 0, label: '1 row' },
  { every: 10, label: 'Every 10th' },
  { every: 1, label: 'Every row' },
] as const;

export default function UpdateScreen() {
  const params = useLocalSearchParams<{ rows?: string }>();
  const count = Number(params.rows) > 0 ? Number(params.rows) : 1000;
  const [values, setValues] = useState(() => new Array<number>(count).fill(0));
  const insets = useSafeAreaInsets();

  // Row 0 (every = 0), every 10th row, or every row. memo keeps the rows
  // whose value didn't change from re-rendering.
  const change = (every: number) => {
    setValues(previous => {
      const next = previous.slice();
      const step = every || count;
      for (let i = 0; i < count; i += step) next[i] = (next[i] ?? 0) + 1;
      return next;
    });
  };

  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push(<Row key={i} id={i} value={values[i] ?? 0} />);
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView style={styles.rows}>{rows}</ScrollView>
      <View style={styles.buttons}>
        {BUTTONS.map(button => (
          <Pressable
            key={button.every}
            style={styles.button}
            accessibilityRole="button"
            accessibilityLabel={button.label}
            onPress={() => change(button.every)}
          >
            <Text style={styles.label}>{button.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const Row = memo(function Row({ id, value }: { id: number; value: number }) {
  return (
    <View style={styles.row}>
      <View style={[styles.box, { backgroundColor: value % 2 ? SENTINEL_B : SENTINEL_A }]} />
      <Text style={styles.name}>Row {id}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#fff',
  },
  rows: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 24,
    paddingHorizontal: 16,
  },
  box: {
    width: 16,
    height: 16,
    marginRight: 8,
  },
  name: {
    flex: 1,
    fontSize: 14,
    color: '#000',
  },
  value: {
    fontSize: 14,
    color: '#000',
  },
  buttons: {
    flexDirection: 'row',
    height: '25%',
  },
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e3e3e3',
    margin: 1,
  },
  label: {
    fontSize: 16,
    color: '#000',
  },
});
