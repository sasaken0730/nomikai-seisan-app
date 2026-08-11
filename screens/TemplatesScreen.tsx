import React, { useState, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl, Modal,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { TemplatesScreenProps } from '../navigation/types'
import { getTemplates, deleteTemplate, type TemplateSummary } from '../lib/actions'
import { getDeviceId } from '../lib/deviceId'
import { Colors } from '../theme/colors'

export default function TemplatesScreen({ navigation }: TemplatesScreenProps) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pickerTarget, setPickerTarget] = useState<TemplateSummary | null>(null)

  useFocusEffect(
    useCallback(() => {
      loadTemplates()
    }, [])
  )

  async function loadTemplates(isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const deviceId = await getDeviceId()
      const data = await getTemplates(deviceId)
      setTemplates(data)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const handleDelete = (id: string) => {
    Alert.alert('削除確認', 'このテンプレートを削除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除', style: 'destructive', onPress: async () => {
          try {
            await deleteTemplate(id)
            setTemplates((prev) => prev.filter((t) => t.id !== id))
          } catch (e) {
            Alert.alert('エラー', e instanceof Error ? e.message : '削除に失敗しました')
          }
        },
      },
    ])
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
  }

  return (
    <>
    <FlatList
      data={templates}
      keyExtractor={(item) => item.id}
      contentContainerStyle={templates.length === 0 ? styles.emptyContainer : styles.listContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadTemplates(true)} tintColor={Colors.primary} />}
      ListEmptyComponent={
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>📂</Text>
          <Text style={styles.emptyTitle}>テンプレートがありません</Text>
          <Text style={styles.emptyDesc}>精算結果画面から「テンプレートとして保存」すると表示されます</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('Create', {})}>
            <Text style={styles.emptyBtnText}>精算を作成する</Text>
          </TouchableOpacity>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <TouchableOpacity style={styles.cardBody} onPress={() => setPickerTarget(item)} activeOpacity={0.8}>
            <View style={styles.cardTop}>
              <Text style={styles.cardName} numberOfLines={1}>{item.template_name}</Text>
              <View style={styles.cardBadge}>
                <Text style={styles.cardBadgeText}>傾斜 {item.tilt_ratio.toFixed(1)}倍</Text>
              </View>
            </View>
            <Text style={styles.cardMeta}>
              参加者 {item.participants_data.length}名
              {item.events_data.length > 0 && ` · ${item.events_data.map((e) => e.name).join('・')}`}
              {item.manual_mode && ' · 手動モード'}
            </Text>
            <Text style={styles.cardParticipants} numberOfLines={1}>
              {item.participants_data.map((p) => p.name).join('、')}
            </Text>
          </TouchableOpacity>
          <View style={styles.cardActions}>
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDelete]} onPress={() => handleDelete(item.id)}>
              <Text style={styles.actionBtnDeleteText}>削除</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    />

      {/* モード選択モーダル */}
      <Modal
        visible={pickerTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerTarget(null)}
      >
        <TouchableOpacity style={styles.pickerOverlay} onPress={() => setPickerTarget(null)} activeOpacity={1}>
          <View style={styles.pickerModal} onStartShouldSetResponder={() => true}>
            <Text style={styles.pickerTitle} numberOfLines={1}>{pickerTarget?.template_name}</Text>
            <TouchableOpacity
              style={[styles.pickerBtn, styles.pickerBtnPrimary]}
              onPress={() => {
                const id = pickerTarget?.id
                setPickerTarget(null)
                if (id) navigation.navigate('Create', { templateId: id })
              }}
            >
              <Text style={[styles.pickerBtnText, styles.pickerBtnPrimaryText]}>📋 このテンプレートを使って精算を作成</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pickerBtn}
              onPress={() => {
                const id = pickerTarget?.id
                setPickerTarget(null)
                if (id) navigation.navigate('Create', { templateEditId: id })
              }}
            >
              <Text style={styles.pickerBtnText}>✏️ このテンプレートを編集する</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pickerCancelBtn} onPress={() => setPickerTarget(null)}>
              <Text style={styles.pickerCancelText}>キャンセル</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  listContent: { padding: 16, gap: 12 },
  emptyContainer: { flex: 1, padding: 16 },
  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  emptyDesc: { fontSize: 14, color: Colors.placeholder, textAlign: 'center', marginBottom: 24, paddingHorizontal: 20 },
  emptyBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  emptyBtnText: { color: Colors.textOnPrimary, fontSize: 15, fontWeight: '700' },
  card: { backgroundColor: Colors.card, borderRadius: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2, overflow: 'hidden' },
  cardBody: { padding: 16 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardName: { fontSize: 16, fontWeight: '700', color: Colors.text, flex: 1, marginRight: 8 },
  cardBadge: { backgroundColor: Colors.accentLight, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  cardBadgeText: { fontSize: 11, color: Colors.warning, fontWeight: '600' },
  cardMeta: { fontSize: 12, color: Colors.placeholder, marginBottom: 4 },
  cardParticipants: { fontSize: 13, color: Colors.textSecondary },
  cardActions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.border },
  actionBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRightWidth: 1, borderRightColor: Colors.border },
  actionBtnDelete: { borderRightWidth: 0 },
  actionBtnText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },
  actionBtnDeleteText: { fontSize: 13, color: Colors.error, fontWeight: '600' },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  pickerModal: { backgroundColor: Colors.card, borderRadius: 20, padding: 24, width: '100%', gap: 10 },
  pickerTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, textAlign: 'center', marginBottom: 4 },
  pickerBtn: { borderWidth: 2, borderColor: Colors.border, borderRadius: 12, paddingVertical: 14, alignItems: 'center', paddingHorizontal: 12 },
  pickerBtnPrimary: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pickerBtnText: { fontSize: 15, fontWeight: '600', color: Colors.text, textAlign: 'center' },
  pickerBtnPrimaryText: { color: Colors.textOnPrimary },
  pickerCancelBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 2 },
  pickerCancelText: { fontSize: 14, color: Colors.placeholder, fontWeight: '600' },
})
