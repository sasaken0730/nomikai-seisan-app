import React from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import HomeScreen from '../screens/HomeScreen'
import CreateScreen from '../screens/CreateScreen'
import RoomScreen from '../screens/RoomScreen'
import EditScreen from '../screens/EditScreen'
import HistoryScreen from '../screens/HistoryScreen'
import TemplatesScreen from '../screens/TemplatesScreen'
import type { RootStackParamList } from './types'
import { Colors } from '../theme/colors'

const Stack = createNativeStackNavigator<RootStackParamList>()

const linking = {
  prefixes: ['nomikai-seisan://', 'exp+nomikai-seisan-app://'],
  config: {
    screens: {
      Home: '',
      Create: 'create',
      Room: 'room/:shareId',
      Edit: 'room/:shareId/edit',
      History: 'history',
      Templates: 'templates',
    },
  },
}

export default function AppNavigator() {
  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: { backgroundColor: Colors.primary },
          headerTintColor: Colors.textOnPrimary,
          headerTitleStyle: { fontWeight: 'bold' },
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: '⚖️ 傾斜精算くん' }} />
        <Stack.Screen name="Create" component={CreateScreen} options={{ title: '精算を作成' }} />
        <Stack.Screen name="Room" component={RoomScreen} options={{ title: '精算結果' }} />
        <Stack.Screen name="Edit" component={EditScreen} options={{ title: '精算を編集' }} />
        <Stack.Screen name="History" component={HistoryScreen} options={{ title: '履歴' }} />
        <Stack.Screen name="Templates" component={TemplatesScreen} options={{ title: 'テンプレート' }} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
