import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{'\u26A0\uFE0F'}</Text>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.message}>{error?.message ?? 'An unexpected error occurred'}</Text>
      <Pressable onPress={retry} style={styles.button}>
        <Text style={styles.buttonText}>Try Again</Text>
      </Pressable>
    </View>
  );
}

export default ErrorBoundary;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 8,
    backgroundColor: '#0c0a09',
  },
  icon: { fontSize: 36 },
  title: { fontSize: 18, fontWeight: '600', color: '#e8e8e8' },
  message: { fontSize: 14, color: '#a8a29e', textAlign: 'center', lineHeight: 20 },
  button: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#3b82f6',
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
