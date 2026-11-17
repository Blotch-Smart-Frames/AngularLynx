import { PokemonImage } from '@/components/PokemonImage';
import { Colors } from '@/constants/colors';
import { FontWeight, TextSize } from '@/constants/font';
import type { PokemonDetail as PokemonDetailModel } from '@/lib/types/pokemon';
import { capitalize } from '@/lib/utils/capitalize';
import { StyleSheet, Text, View } from 'react-native';

interface Props {
  pokemon: PokemonDetailModel;
}

export function PokemonDetail({ pokemon }: Props) {
  const types = pokemon.types.map(capitalize).join(', ') || '—';
  const abilities = pokemon.abilities.map(capitalize).join(', ') || '—';

  return (
    <View style={styles.container}>
      <View style={styles.imageWrapper}>
        <PokemonImage uri={pokemon.imageUrl} size={200} />
      </View>

      <Text style={styles.header}>{capitalize(pokemon.name)}</Text>

      <View style={styles.infoRows}>
        <InfoRow label="Dex №" value={`#${pokemon.id.padStart(3, '0')}`} />
        <Separator />
        <InfoRow label="Type" value={types} />
        <Separator />
        <InfoRow label="Height" value={`${(pokemon.height / 10).toFixed(1)} m`} />
        <Separator />
        <InfoRow label="Weight" value={`${(pokemon.weight / 10).toFixed(1)} kg`} />
        <Separator />
        <InfoRow label="Base XP" value={`${pokemon.baseExperience}`} />
        <Separator />
        <InfoRow label="Abilities" value={abilities} />
      </View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  header: {
    ...TextSize.xl2,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
  },
  infoRows: {
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    ...TextSize.sm,
    color: Colors.textSecondary,
  },
  infoValue: {
    ...TextSize.sm,
    color: Colors.textPrimary,
    fontWeight: FontWeight.medium,
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 16,
  },
  separator: {
    height: 1,
    backgroundColor: Colors.border,
  },
  imageWrapper: {
    alignSelf: 'center',
  },
});
