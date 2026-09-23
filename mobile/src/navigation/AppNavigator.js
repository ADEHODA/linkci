import React from 'react';
import { TouchableOpacity } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';

import FeedScreen from '../screens/FeedScreen';
import ExploreScreen from '../screens/ExploreScreen';
import ProfileScreen from '../screens/ProfileScreen';
import MessagingScreen from '../screens/MessagingScreen';
import BoursesScreen from '../screens/BoursesScreen';
import FormationsScreen from '../screens/FormationsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import CalendarScreen from '../screens/CalendarScreen';
import GroupsScreen from '../screens/GroupsScreen';
import DocumentsScreen from '../screens/DocumentsScreen';
import SearchScreen from '../screens/SearchScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import { colors, headerOptions } from '../theme';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  Accueil: 'home',
  Explorer: 'compass',
  Messages: 'chatbubbles',
  Alertes: 'notifications',
  Profil: 'person',
};

const navTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.bg, primary: colors.primary } };

function HomeTabs({ onLogout }) {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        ...headerOptions,
        tabBarIcon: ({ color, size, focused }) => (
          <Ionicons name={focused ? TAB_ICONS[route.name] : `${TAB_ICONS[route.name]}-outline`} size={size} color={color} />
        ),
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { height: 62, paddingTop: 6, paddingBottom: 8, borderTopColor: colors.border, backgroundColor: colors.card },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      })}
    >
      <Tab.Screen
        name="Accueil"
        component={FeedScreen}
        options={({ navigation }) => ({
          title: 'LINK CI',
          tabBarLabel: 'Accueil',
          headerTitleStyle: { ...headerOptions.headerTitleStyle, color: colors.primary, fontWeight: '900', letterSpacing: 0.5 },
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.navigate('Search')} style={{ marginRight: 16 }}>
              <Ionicons name="search" size={22} color={colors.text} />
            </TouchableOpacity>
          ),
        })}
      />
      <Tab.Screen name="Explorer" component={ExploreScreen} />
      <Tab.Screen name="Messages" component={MessagingScreen} />
      <Tab.Screen name="Alertes" component={NotificationsScreen} options={{ title: 'Notifications', tabBarLabel: 'Alertes' }} />
      <Tab.Screen name="Profil">
        {(props) => <ProfileScreen {...props} onLogout={onLogout} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export default function AppNavigator({ token, onLogin, onLogout }) {
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ ...headerOptions, headerBackTitle: 'Retour' }}>
        {token ? (
          <>
            <Stack.Screen name="Home" options={{ headerShown: false }}>
              {() => <HomeTabs onLogout={onLogout} />}
            </Stack.Screen>
            <Stack.Screen name="Bourses" component={BoursesScreen} />
            <Stack.Screen name="Formations" component={FormationsScreen} />
            <Stack.Screen name="Documents" component={DocumentsScreen} />
            <Stack.Screen name="Groupes" component={GroupsScreen} />
            <Stack.Screen name="Calendrier" component={CalendarScreen} />
            <Stack.Screen name="Search" component={SearchScreen} options={{ title: 'Recherche' }} />
            <Stack.Screen name="ModifierProfil" component={EditProfileScreen} options={{ title: 'Modifier le profil' }} />
          </>
        ) : (
          <>
            <Stack.Screen name="Login" options={{ headerShown: false }}>
              {(props) => <LoginScreen {...props} onLogin={onLogin} />}
            </Stack.Screen>
            <Stack.Screen name="Register" options={{ headerShown: false }}>
              {(props) => <RegisterScreen {...props} onLogin={onLogin} />}
            </Stack.Screen>
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
