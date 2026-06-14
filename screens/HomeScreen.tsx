import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import type { HomeScreenProps } from '../navigation/types'

export default function HomeScreen({ navigation }: HomeScreenProps) {
  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.title}>⚖️ 傾斜精算くん</Text>
        <Text style={styles.subtitle}>役職・年次に応じた飲み会精算</Text>
      </View>

      <View style={styles.grid}>
        <TouchableOpacity style={[styles.card, styles.primaryCard]} onPress={() => navigation.navigate('Create', {})}>
          <Text style={styles.cardIcon}>＋</Text>
          <Text style={styles.cardTitle}>新規精算</Text>
          <Text style={styles.cardDesc}>参加者とイベントを入力して精算</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('History')}>
          <Text style={[styles.cardIcon, styles.darkIcon]}>📋</Text>
          <Text style={[styles.cardTitle, styles.darkTitle]}>履歴</Text>
          <Text style={styles.cardDescDark}>保存済みの精算を確認</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('Templates')}>
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
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1a1a2e',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: '#6b7280',
    marginTop: 6,
  },
  grid: {
    gap: 14,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  primaryCard: {
    backgroundColor: '#1a1a2e',
  },
  cardIcon: {
    fontSize: 28,
    color: '#fff',
    marginBottom: 8,
  },
  darkIcon: {
    fontSize: 28,
    color: '#1a1a2e',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  darkTitle: {
    color: '#1a1a2e',
  },
  cardDesc: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
  },
  cardDescDark: {
    fontSize: 13,
    color: '#6b7280',
  },
})
