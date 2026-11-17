import { BasicPressable } from '@/components/BasicPressable';
import { FavouriteButton } from '@/components/FavouriteButton';
import { PokemonImage } from '@/components/PokemonImage';
import { PokemonTypeDot } from '@/components/PokemonTypeDot';
import { Colors } from '@/constants/colors';
import { usePokemon } from '@/lib/hooks/usePokemon';
import type { Pokemon } from '@/lib/types/pokemon';
import { capitalize } from '@/lib/utils/capitalize';
import { router } from 'expo-router';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

function PokemonItem({ pokemon, index }: { pokemon: Pokemon; index: number }) {
  const detail = usePokemon(pokemon.id);

  return (
    <BasicPressable
      style={styles.card}
      onPress={() => router.navigate(`/pokemon/${pokemon.id}`)}
      testID={`pokemon_tile_${pokemon.id}`}
    >
      <View style={styles.image}>
        <PokemonImage uri={pokemon.imageUrl} size={56} />
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {index + 1}. {capitalize(pokemon.name || (detail.data?.name ?? ''))}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          #{pokemon.id.padStart(3, '0')}
        </Text>
      </View>
      <View style={styles.trailing}>
        {detail.data && (
          <View style={styles.typeDots}>
            {detail.data.types.map(type => (
              <PokemonTypeDot key={type} name={type} size={20} />
            ))}
          </View>
        )}
        <FavouriteButton
          name={pokemon.id}
          style={styles.heartButton}
          size={20}
          testID={`pokemon_tile_heart_${pokemon.id}`}
        />
      </View>
    </BasicPressable>
  );
}

export default memo(PokemonItem);

const styles = StyleSheet.create({
  card: {
    flex: 1,
    padding: 16,
    borderRadius: 4,
    backgroundColor: Colors.white,
    marginBottom: 8,
    borderColor: Colors.border,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  image: {
    width: 64,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderRadius: 8,
    borderColor: Colors.border,
    borderWidth: 1,
  },
  info: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 8,
  },
  typeDots: {
    flexDirection: 'row',
    gap: 4,
  },
  heartButton: {},
});
