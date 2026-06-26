import app
app.init_db()
app.socketio.run(app.app, host='127.0.0.1', port=5000, debug=False, allow_unsafe_werkzeug=True)
