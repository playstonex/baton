import { View, ActivityIndicator } from 'react-native';

export default function Loading() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0c0a09' }}>
      <ActivityIndicator size="large" color="#3b82f6" />
    </View>
  );
}
