import PokemonItem from '@/components/PokemonItem';
import type { Pokemon } from '@/lib/types/pokemon';
import { ActivityIndicator, FlatList, type FlatListProps, StyleSheet, Text } from 'react-native';

const keyExtractor = (item: Pokemon) => item.id;

const renderItem = ({ item, index }: { item: Pokemon; index: number }) => (
  <PokemonItem pokemon={item} index={index} />
);

interface PokemonListProps extends Pick<FlatListProps<Pokemon>, 'ListEmptyComponent'> {
  data: Pokemon[] | undefined;
  headerText: string;
  onEndReached?: () => void;
  isFetchingNextPage?: boolean;
}

export default function PokemonList({
  data,
  headerText,
  ListEmptyComponent,
  onEndReached,
  isFetchingNextPage,
}: PokemonListProps) {
  return (
    <FlatList
      data={data}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={<Text style={styles.listHeader}>{headerText}</Text>}
      ListEmptyComponent={ListEmptyComponent}
      renderItem={renderItem}
      contentInsetAdjustmentBehavior="automatic"
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      ListFooterComponent={isFetchingNextPage ? <ActivityIndicator style={styles.footer} /> : null}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: 16,
    flexGrow: 1,
  },
  listHeader: {
    marginBottom: 8,
    fontSize: 16,
    fontWeight: 'bold',
  },
  footer: {
    paddingVertical: 16,
  },
});
