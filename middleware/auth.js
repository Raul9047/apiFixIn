// middleware/auth.js
const admin = require('../config/firebaseAdmin');
const pool = require('../config/db');

// Función para verificar el token y devolver el usuario decodificado o null
const verificarTokenBase = async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error('Error al verificar el token:', error);
    return null;
  }
};

// Middleware generico para autenticar solo con el token de Firebase
const soloToken = async (req, res, next) => {
  const decodedToken = await verificarTokenBase(req, res);
  if (!decodedToken) {
    return res.status(403).send('Acceso no autorizado: Token inválido o ausente');
  }
  req.firebase_uid = decodedToken.uid;
  req.usuario_firebase = decodedToken;
  next();
};

// Middleware para USUARIOS (Clientes finales)
const autenticarUsuario = async (req, res, next) => {
  const decodedToken = await verificarTokenBase(req, res);
  if (!decodedToken) {
    return res.status(403).send('Acceso no autorizado');
  }
  req.firebase_uid = decodedToken.uid;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM usuarios WHERE firebase_uid = $1',
      [req.firebase_uid]
    );

    if (rows.length > 0) {
      req.usuario_postgres = rows[0];
      next();
    } else {
      return res.status(404).send('Usuario no registrado en el sistema.');
    }
  } catch (error) {
    console.error('Error DB Usuario:', error);
    res.status(500).send('Error del servidor');
  }
};

// 3. Middleware para EMPRESAS (Talleres, Lavaderos, etc.)
const autenticarEmpresa = async (req, res, next) => {
  const decodedToken = await verificarTokenBase(req, res);
  if (!decodedToken) {
    return res.status(403).send('Acceso no autorizado');
  }

  req.firebase_uid = decodedToken.uid;

  try {
    // Buscamos en la tabla EMPRESAS
    const { rows } = await pool.query(
      'SELECT * FROM empresas WHERE firebase_uid = $1',
      [req.firebase_uid]
    );

    if (rows.length > 0) {
      req.empresa_postgres = rows[0];
      next();
    } else {
      return res.status(404).send('Empresa no encontrada o no registrada.');
    }
  } catch (error) {
    console.error('Error DB Empresa:', error);
    res.status(500).send('Error del servidor');
  }
};

module.exports = {
  soloToken,
  autenticarUsuario,
  autenticarEmpresa
};