import React, { useState, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import * as Haptics from 'expo-haptics'
import type { HomeScreenProps } from '../navigation/types'
import { supabase } from '../lib/supabase'
import { getDeviceId } from '../lib/deviceId'
import { Colors } from '../theme/colors'

interface DraftRoom {
  shareId: string
  eventDate: string | null
}

export default function HomeScreen({ navigation }: HomeScreenProps) {
  const [draftRoom, setDraftRoom] = useState<DraftRoom | null>(null)

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      ;(async () => {
        const deviceId = await getDeviceId()
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const { data } = await supabase
          .from('nomikai_seisan_rooms')
          .select('share_id, event_date, created_at')
          .eq('created_by_device_id', deviceId)
          .eq('is_saved', false)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(1)
        if (cancelled) return
        const room = data?.[0]
        setDraftRoom(room ? { shareId: room.share_id as string, eventDate: room.event_date as string | null } : null)
      })()
      return () => { cancelled = true }
    }, [])
  )

  const goTo = (screen: 'Create' | 'History' | 'Templates') => {
    Haptics.selectionAsync()
    if (screen === 'Create') navigation.navigate('Create', {})
    else navigation.navigate(screen)
  }

  const resumeDraft = () => {
    if (!draftRoom) return
    Haptics.selectionAsync()
    navigation.navigate('Create', { resumeDraftShareId: draftRoom.shareId })
  }

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.title}>⚖️ 傾斜精算くん</Text>
        <Text style={styles.subtitle}>役職・年次に応じた飲み会精算</Text>
      </View>

      {draftRoom && (
        <TouchableOpacity style={styles.draftBanner} onPress={resumeDraft} activeOpacity={0.85}>
          <Text style={styles.draftBannerIcon}>📝</Text>
          <View style={styles.flex1}>
            <Text style={styles.draftBannerTitle}>作業中の精算があります</Text>
            <Text style={styles.draftBannerSub}>{draftRoom.eventDate ? `${draftRoom.eventDate}・` : ''}タップして再開</Text>
          </View>
          <Text style={styles.draftBannerArrow}>›</Text>
        </TouchableOpacity>
      )}

      <View style={styles.grid}>
        <TouchableOpacity style={[styles.card, styles.primaryCard]} onPress={() => goTo('Create')}>
          <Text style={styles.cardIcon}>＋</Text>
          <Text style={styles.cardTitle}>新規精算</Text>
          <Text style={styles.cardDesc}>参加者とイベントを入力して精算</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => goTo('History')}>
          <Text style={[styles.cardIcon, styles.darkIcon]}>📋</Text>
          <Text style={[styles.cardTitle, styles.darkTitle]}>履歴</Text>
          <Text style={styles.cardDescDark}>保存済みの精算を確認</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => goTo('Templates')}>
          <Text style={[styles.cardIcon, styles.darkIcon]}>📂</Text>
          <Text style={[styles.cardTitle, styles.darkTitle]}>テンプレート</Text>
          <Text style={styles.cardDescDark}>よく使う設定を再利用</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: 20,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginTop: 6,
  },
  grid: {
    gap: 14,
  },
  flex1: { flex: 1 },
  draftBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.accentLight, borderWidth: 1, borderColor: Colors.accentLight,
    borderRadius: 14, padding: 14, marginBottom: 16, gap: 10,
  },
  draftBannerIcon: { fontSize: 22 },
  draftBannerTitle: { fontSize: 14, fontWeight: '700', color: Colors.warning },
  draftBannerSub: { fontSize: 12, color: Colors.warning, marginTop: 2 },
  draftBannerArrow: { fontSize: 22, color: Colors.warning, fontWeight: '700' },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  primaryCard: {
    backgroundColor: Colors.primary,
  },
  cardIcon: {
    fontSize: 28,
    color: Colors.textOnPrimary,
    marginBottom: 8,
  },
  darkIcon: {
    fontSize: 28,
    color: Colors.primary,
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textOnPrimary,
    marginBottom: 4,
  },
  darkTitle: {
    color: Colors.primary,
  },
  cardDesc: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
  },
  cardDescDark: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
})
