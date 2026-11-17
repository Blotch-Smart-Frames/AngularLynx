import type { PokemonDetail as PokemonDetailModel } from '../lib/types/pokemon';
import { capitalize } from '../lib/utils/capitalize';
import { PokemonImage } from './PokemonImage';

export function PokemonDetail({ pokemon }: { pokemon: PokemonDetailModel }) {
  const types = pokemon.types.map(capitalize).join(', ') || '—';
  const abilities = pokemon.abilities.map(capitalize).join(', ') || '—';

  return (
    <view className="fill">
      <view className="detail-image">
        <PokemonImage uri={pokemon.imageUrl} size={200} />
      </view>

      <text className="detail-name">{capitalize(pokemon.name)}</text>

      <view className="detail-rows">
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
      </view>
    </view>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <view className="detail-row">
      <text className="detail-label">{label}</text>
      <text className="detail-value">{value}</text>
    </view>
  );
}

function Separator() {
  return <view className="detail-separator" />;
}
