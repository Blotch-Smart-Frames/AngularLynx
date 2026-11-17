import { Colors } from '@/constants/colors';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

interface Props {
  isLoading: boolean;
  isError: boolean;
  emptyMessage: string;
}

export default function ListEmpty({ isLoading, isError, emptyMessage }: Props) {
  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (isError) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Failed to load</Text>
      </View>
    );
  }
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{emptyMessage}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 64,
  },
  text: {
    color: Colors.textSecondary,
  },
});
