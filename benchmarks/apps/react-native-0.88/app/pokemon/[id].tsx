import { Link, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View, Text, ActivityIndicator, Dimensions, Platform } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { usePokemon } from '@/lib/hooks/usePokemon';
import { Colors } from '@/constants/colors';
import { PokemonDetail } from '@/components/PokemonDetail';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FavouriteButton } from '@/components/FavouriteButton';

type PokemonScreenParams = {
  id: string;
};

export default function PokemonScreen() {
  const { id } = useLocalSearchParams<PokemonScreenParams>();
  const pokemon = usePokemon(id);

  const insets = useSafeAreaInsets();

  if (pokemon.isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.handle} />
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" />
        </View>
      </View>
    );
  }

  if (pokemon.isError || !pokemon.data) {
    return (
      <View style={styles.container}>
        <View style={styles.handle} />
        <View style={styles.centerContainer}>
          <Text>Failed to load the Pokémon</Text>
          <Link href="/" dismissTo style={styles.link}>
            <Text>Close</Text>
          </Link>
        </View>
      </View>
    );
  }

  return (
    <>
      <View style={styles.header} collapsable={false}>
        <View style={styles.handle} />
        <FavouriteButton name={id} size={30} style={styles.favouriteButton} />
      </View>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.dataContainer,
          Platform.OS === 'android' && { paddingBottom: 24 + insets.bottom },
        ]}
      >
        <PokemonDetail pokemon={pokemon.data} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  centerContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    height: Dimensions.get('window').height / 2,
  },
  scrollView: {
    flex: 1,
  },
  dataContainer: {
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  handle: {
    width: 64,
    height: 4,
    borderRadius: 2,
    marginVertical: 12,
    backgroundColor: Colors.textPrimary,
    alignSelf: 'center',
  },
  header: {
    height: 52,
    justifyContent: 'center',
  },
  favouriteButton: {
    position: 'absolute',
    right: 16,
    top: 11,
  },
});
