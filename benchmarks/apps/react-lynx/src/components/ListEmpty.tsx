import { ActivityIndicator } from './ActivityIndicator';

interface Props {
  isLoading: boolean;
  isError: boolean;
  emptyMessage: string;
}

export default function ListEmpty({ isLoading, isError, emptyMessage }: Props) {
  if (isLoading) {
    return (
      <view className="list-empty">
        <ActivityIndicator size="large" />
      </view>
    );
  }
  return (
    <view className="list-empty">
      <text className="list-empty-text">{isError ? 'Failed to load' : emptyMessage}</text>
    </view>
  );
}
