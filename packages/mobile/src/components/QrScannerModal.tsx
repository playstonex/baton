import { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useThemeColors } from '../hooks/useThemeColors';
import { GlassButton } from './GlassKit';
import { Typography, Spacing, Colors } from '../constants/theme';

export interface ScannedPairingData {
  localHttpUrl?: string;
  localWsUrl?: string;
  relayUrl?: string;
  pairingCode?: string;
  fingerprint?: string;
  name?: string;
  raw: string;
}

interface QrScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onScan: (data: ScannedPairingData) => void;
}

export function QrScannerModal({ visible, onClose, onScan }: QrScannerModalProps) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (visible) {
      setScanned(false);
    }
  }, [visible]);

  function handleBarcode(raw: string) {
    if (scanned) return;
    setScanned(true);

    let parsed: ScannedPairingData = { raw };
    try {
      const json = JSON.parse(raw);
      if (typeof json === 'object' && json !== null) {
        parsed = {
          raw,
          localHttpUrl: json.localHttpUrl || (json.url?.startsWith('http') ? json.url : undefined),
          localWsUrl: json.localWsUrl,
          relayUrl: json.relay || json.relayUrl,
          pairingCode: json.code || json.pairingCode,
          fingerprint: json.fp || json.fingerprint,
          name: json.name || json.daemonId,
        };
      }
    } catch {
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        parsed = {
          raw,
          localHttpUrl: raw,
          localWsUrl: raw.replace(/^http/, 'ws').replace(/:\d+$/, ':3211'),
        };
      }
    }

    onScan(parsed);
    onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: '#000' }]}>
        {/* Camera or Permission Prompt */}
        {!permission?.granted ? (
          <View style={[styles.permissionContainer, { paddingTop: insets.top + Spacing.xl }]}>
            <View style={styles.permissionIconCircle}>
              <Ionicons name="camera-outline" size={44} color={Colors.primary[400]} />
            </View>
            <Text style={[Typography.title2, { color: '#fff', textAlign: 'center' }]}>
              Camera Access Required
            </Text>
            <Text style={[Typography.body, { color: '#8e8e93', textAlign: 'center', marginTop: 8 }]}>
              Allow Baton to use your camera to scan pairing QR codes from your terminal or web dashboard.
            </Text>
            <View style={{ marginTop: Spacing.xl, width: '100%', gap: Spacing.md }}>
              <GlassButton
                c={c}
                label="Grant Permission"
                variant="primary"
                onPress={requestPermission}
              />
              <GlassButton
                c={c}
                label="Cancel"
                variant="secondary"
                onPress={onClose}
              />
            </View>
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
              }}
              onBarcodeScanned={(result) => {
                if (result.data) {
                  handleBarcode(result.data);
                }
              }}
            />

            {/* Viewfinder Overlay */}
            <View style={styles.overlay}>
              <View style={[styles.maskTop, { height: insets.top + 80 }]} />
              <View style={styles.viewfinderRow}>
                <View style={styles.maskSide} />
                <View style={styles.viewfinderBox}>
                  {/* Four Corner Marks */}
                  <View style={[styles.corner, styles.cornerTL]} />
                  <View style={[styles.corner, styles.cornerTR]} />
                  <View style={[styles.corner, styles.cornerBL]} />
                  <View style={[styles.corner, styles.cornerBR]} />
                </View>
                <View style={styles.maskSide} />
              </View>
              <View style={styles.maskBottom}>
                <Text style={styles.hintText}>
                  Point camera at terminal or web pairing QR code
                </Text>
              </View>
            </View>
          </>
        )}

        {/* Top Header Bar with Close Button */}
        <View style={[styles.header, { top: insets.top + Spacing.sm }]}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={styles.closeButton}
            accessibilityLabel="Close QR Scanner"
          >
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
          <Text style={[Typography.headline, { color: '#fff' }]}>Scan Pairing QR</Text>
          <View style={{ width: 36 }} />
        </View>
      </View>
    </Modal>
  );
}

const VIEWFINDER_SIZE = 260;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionContainer: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  maskTop: {
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    width: '100%',
  },
  viewfinderRow: {
    flexDirection: 'row',
    height: VIEWFINDER_SIZE,
  },
  maskSide: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  viewfinderBox: {
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: '#3b82f6',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 10,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 10,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 10,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 10,
  },
  maskBottom: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    paddingTop: Spacing.xl,
    paddingHorizontal: Spacing.xl,
  },
  hintText: {
    ...Typography.footnote,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
  },
});
