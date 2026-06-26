import React from 'react';
import { TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';

import FeedScreen from '../screens/FeedScreen';
import ProfileScreen from '../screens/ProfileScreen';
import MessagingScreen from '../screens/MessagingScreen';
import BoursesScreen from '../screens/BoursesScreen';
import FormationsScreen from '../screens/FormationsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import CalendarScreen from '../screens/CalendarScreen';
import GroupsScreen from '../screens/GroupsScreen';
import DocumentsScreen from '../screens/DocumentsScreen';
import SearchScreen from '../screens/SearchScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

const ORANGE = '#FF6B35';

function HomeTabs({ onLogout }) {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color, size }) => {
          const icons = {
            Feed: 'newspaper',
            Bourses: 'cash',
            Formations: 'school',
            Messages: 'chatbubbles',
            Notifications: 'notifications',
            Calendrier: 'calendar',
            Groupes: 'people',
            Documents: 'folder',
            Profil: 'person',
          };
          return <Ionicons name={icons[route.name]} size={size} color={color} />;
        },
        tabBarActiveTintColor: ORANGE,
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: { paddingBottom: 2, height: 54 },
        tabBarLabelStyle: { fontSize: 9, marginTop: -2 },
        tabBarItemStyle: { paddingHorizontal: 0 },
        headerStyle: { backgroundColor: ORANGE },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      })}
    >
      <Tab.Screen name="Feed" component={FeedScreen} options={({ navigation }) => ({ title: 'Fil', headerRight: () => <TouchableOpacity onPress={() => navigation.navigate('Search')} style={{ marginRight: 14 }}><Ionicons name="search" size={22} color="white" /></TouchableOpacity> })} />
      <Tab.Screen name="Bourses" component={BoursesScreen} options={{ title: 'Bourses' }} />
      <Tab.Screen name="Formations" component={FormationsScreen} options={{ title: 'Formations' }} />
      <Tab.Screen name="Groupes" component={GroupsScreen} options={{ title: 'Groupes' }} />
      <Tab.Screen name="Messages" component={MessagingScreen} options={{ title: 'Messages' }} />
      <Tab.Screen name="Calendrier" component={CalendarScreen} options={{ title: 'Calendrier' }} />
      <Tab.Screen name="Documents" component={DocumentsScreen} options={{ title: 'Documents' }} />
      <Tab.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Alertes' }} />
      <Tab.Screen name="Profil" options={{ title: 'Profil', headerRight: () => null }}>
        {(props) => <ProfileScreen {...props} onLogout={onLogout} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export default function AppNavigator({ token, onLogin, onLogout }) {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {token ? (
          <>
            <Stack.Screen name="Home">
              {() => <HomeTabs onLogout={onLogout} />}
            </Stack.Screen>
            <Stack.Screen name="Search" component={SearchScreen} options={{ headerShown: true, title: 'Recherche', headerStyle: { backgroundColor: ORANGE }, headerTintColor: '#fff' }} />
          </>
        ) : (
          <>
            <Stack.Screen name="Login">
              {(props) => <LoginScreen {...props} onLogin={onLogin} />}
            </Stack.Screen>
            <Stack.Screen name="Register">
              {(props) => <RegisterScreen {...props} onLogin={onLogin} />}
            </Stack.Screen>
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
