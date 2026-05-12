const firebaseConfig = {
  apiKey: "AIzaSyCWG5hdQoEEbrON0cWxT6qEz6Oww4aax4Y",
  authDomain: "game-mouraleite.firebaseapp.com",
  projectId: "game-mouraleite",
  storageBucket: "game-mouraleite.firebasestorage.app",
  messagingSenderId: "55851730832",
  appId: "1:55851730832:web:8088a76822be8ed82e5515"
};

// Initialize Firebase using the compat SDK
firebase.initializeApp(firebaseConfig);
window.db = firebase.firestore();
