require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient, TipoEntrega, MetodoPago } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();

// —————— Middlewares globales ——————
app.use(cors());
app.use(express.json());

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token no enviado' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const empresa = await prisma.empresa.findUnique({ where: { id: payload.empresaId } });

    console.log("EMPRESA ENCONTRADA:", empresa); // 👈 Añadido

    if (!empresa || !empresa.suscripcionActiva) {
      return res.status(403).json({ error: '❌ Suscripción inactiva o empresa no válida' });
    }

    req.empresaId = empresa.id;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
}



function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  next();
}

// —————— Healthcheck ——————
app.get('/', (req, res) => {
  res.send('🚀 Backend Veclity funcionando');
});

// —————— Rutas de Empresa ——————
app.post('/api/empresas', adminAuth, async (req, res) => {
  const { nombre, direccion, telefono, correo, contrasena, tipo } = req.body;
  try {
    const hashed = await bcrypt.hash(contrasena, 10);
    const nueva = await prisma.empresa.create({
      data: { nombre, direccion, telefono, correo, contrasena: hashed, tipo }
    });
    res.status(201).json({ message: '✅ Empresa registrada', empresaId: nueva.id });
  } catch (err) {
    res.status(400).json({ error: '❌ Error al registrar empresa: ' + err.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { correo, contrasena } = req.body;

  try {
    const emp = await prisma.empresa.findUnique({ where: { correo } });

    if (!emp) {
      return res.status(401).json({ error: ' Correo no encontrado' });
    }

    const valid = await bcrypt.compare(contrasena, emp.contrasena);
    if (!valid) {
      return res.status(401).json({ error: ' Contraseña incorrecta' });
    }

    if (!emp.suscripcionActiva) {
      return res.status(403).json({ error: ' Tu suscripción ha caducado' });
    }
	console.log("➡️ Empresa encontrada:", emp);
console.log("📦 Suscripción activa:", emp.suscripcionActiva, typeof emp.suscripcionActiva);


    const token = jwt.sign(
      { empresaId: emp.id },
      process.env.JWT_SECRET,
      
    );

    res.json({
      token,
      empresa: {
        id: emp.id,
        nombre: emp.nombre,
        tipo: emp.tipo
      }
    });

  } catch (err) {
    res.status(500).json({ error: '❌ Error interno: ' + err.message });
  }
});

// —————— Rutas de Empleado ——————
app.post('/api/empleados', authenticateToken, async (req, res) => {
  const { nombre, apellido1, apellido2, email, telefono, fechaIngreso } = req.body;
  try {
    const nuevo = await prisma.empleado.create({
      data: { empresaId: req.empresaId, nombre, apellido1, apellido2, email, telefono, fechaIngreso: new Date(fechaIngreso) }
    });
    res.status(201).json(nuevo);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/empleados', authenticateToken, async (req, res) => {
  try {
    const lista = await prisma.empleado.findMany({ where: { empresaId: req.empresaId }, orderBy: { nombre: 'asc' } });
    res.json(lista);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/empleados/:id', authenticateToken, async (req, res) => {
  const id = Number(req.params.id);
  const { nombre, apellido1, apellido2, email, telefono, activo } = req.body;
  try {
    const emp = await prisma.empleado.findUnique({ where: { id } });
    if (!emp || emp.empresaId !== req.empresaId) {
      return res.status(403).json({ error: '❌ Sin permiso' });
    }
    const updated = await prisma.empleado.update({ where: { id }, data: { nombre, apellido1, apellido2, email, telefono, activo } });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/empleados/:id', authenticateToken, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const emp = await prisma.empleado.findUnique({ where: { id } });
    if (!emp || emp.empresaId !== req.empresaId) {
      return res.status(403).json({ error: '❌ Sin permiso' });
    }
    await prisma.empleado.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// —————— Rutas de Citas ——————
	


app.get('/api/mis-citas', authenticateToken, async (req, res) => {
  try {
    const citas = await prisma.cita.findMany({ where: { empresaId: req.empresaId }, orderBy: { fechaHora: 'asc' } });
    res.json(citas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/citas/:id', authenticateToken, async (req, res) => {
  const id = Number(req.params.id);
  const { empleadoId, clienteNombre, clienteTelefono, fechaHora, duracion, notas } = req.body;
  if (fechaHora && new Date(fechaHora) < new Date()) {
    return res.status(400).json({ error: '❌ Fecha en pasado' });
  }
  try {
    const cita = await prisma.cita.findUnique({ where: { id } });
    if (!cita || cita.empresaId !== req.empresaId) {
      return res.status(403).json({ error: '❌ Sin permiso' });
    }
    const updated = await prisma.cita.update({
      where: { id },
      data: { empleadoId, clienteNombre, clienteTelefono, fechaHora: fechaHora ? new Date(fechaHora) : undefined, duracion, notas }
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/citas/:id', authenticateToken, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const cita = await prisma.cita.findUnique({ where: { id } });
    if (!cita || cita.empresaId !== req.empresaId) {
      return res.status(403).json({ error: '❌ Sin permiso' });
    }
    await prisma.cita.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/mis-citas', authenticateToken, async (req, res) => {
  const telefono = req.query.telefono?.replace('@c.us', '');

  if (!telefono) {
    return res.status(400).json({ error: 'Número de teléfono requerido' });
  }

  try {
    const citas = await prisma.cita.findMany({
      where: {
        empresaId: req.empresaId,
        clienteTelefono: telefono
      },
      orderBy: { fechaHora: 'asc' }
    });

    res.json(citas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/citas/empleado/:id', authenticateToken, async (req, res) => {
  const empleadoId = Number(req.params.id);
  try {
    const citas = await prisma.cita.findMany({
      where: {
        empresaId: req.empresaId,
        empleadoId
      },
      orderBy: { fechaHora: 'asc' }
    });
    res.json(citas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/citas', authenticateToken, async (req, res) => {
  let {
    empleadoId,
    clienteNombre,
    clienteTelefono,
    fechaHora,
    duracion,
    notas,
    precio: precioEnviado
  } = req.body;

  // ✅ Asegurarse de que empleadoId sea un número
  empleadoId = parseInt(empleadoId);
  if (isNaN(empleadoId)) {
    return res.status(400).json({ error: 'ID del empleado inválido' });
  }

  const horaInicio = new Date(fechaHora);
  if (horaInicio < new Date()) {
    return res.status(400).json({ error: '❌ No se puede reservar en el pasado' });
  }

  const horaFin = new Date(horaInicio.getTime() + duracion * 60000);

  // Comprobar si hay solape con otra cita (misma empresa y estilista)
  const haySolape = await prisma.cita.findFirst({
    where: {
      empresaId: req.empresaId,
      empleadoId,
      OR: [
        {
          fechaHora: {
            lt: horaFin
          },
          duracion: {
            gt: ((horaInicio - new Date()) / 60000)
          }
        },
        {
          fechaHora: {
            gte: horaInicio,
            lt: horaFin
          }
        }
      ]
    }
  });

  if (haySolape) {
    // Sugerir horarios alternativos
    let alternativas = [];
    const ventanaBusquedaMin = 4 * 60;
    let revisado = 0;
    let intento = 1;
    let buscaInicio = new Date(horaInicio);

    while (alternativas.length < 5 && revisado < ventanaBusquedaMin) {
      buscaInicio = new Date(buscaInicio.getTime() + 30 * 60000);
      revisado += 30;
      let buscaFin = new Date(buscaInicio.getTime() + duracion * 60000);

      const existeAlternativa = await prisma.cita.findFirst({
        where: {
          empresaId: req.empresaId,
          empleadoId,
          OR: [
            {
              fechaHora: {
                lt: buscaFin
              },
              duracion: {
                gt: ((buscaInicio - new Date()) / 60000)
              }
            },
            {
              fechaHora: {
                gte: buscaInicio,
                lt: buscaFin
              }
            }
          ]
        }
      });

      if (!existeAlternativa) {
        alternativas.push(buscaInicio.toISOString());
      }
      intento++;
      if (intento > 20) break;
    }

    return res.status(409).json({
      error: 'La hora solicitada está ocupada',
      alternativas
    });
  }

  // Crear cita si no hay solapes
  const precio = typeof precioEnviado === 'number' ? precioEnviado : 0;
  try {
    const cita = await prisma.cita.create({
      data: {
        empresaId: req.empresaId,
        empleadoId,
        clienteNombre,
        clienteTelefono,
        fechaHora: horaInicio,
        duracion,
        notas,
        precio
      }
    });
    res.status(201).json(cita);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});




// —————— Rutas de Pedidos ——————
app.post('/api/pedidos', authenticateToken, async (req, res) => {
  const { clienteNombre, clienteTelefono, descripcion, tipoEntrega, horaRecogida, direccion, metodoPago } = req.body;
  if (!['RECOGER', 'DOMICILIO'].includes(tipoEntrega)) {
    return res.status(400).json({ error: 'tipoEntrega inválido' });
  }
  if (tipoEntrega === 'RECOGER' && !horaRecogida) {
    return res.status(400).json({ error: 'Se requiere horaRecogida para RECOGER' });
  }
  if (tipoEntrega === 'DOMICILIO' && (!direccion || !['TARJETA','EFECTIVO'].includes(metodoPago))) {
    return res.status(400).json({ error: 'Se requieren direccion y metodoPago válidos para DOMICILIO' });
  }
  try {
    const pedido = await prisma.pedido.create({
      data: { empresaId: req.empresaId, clienteNombre, clienteTelefono, descripcion, tipoEntrega, horaRecogida: horaRecogida ? new Date(horaRecogida): undefined, direccion, metodoPago }
    });
    res.status(201).json(pedido);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/pedidos', authenticateToken, async (req, res) => {
  try {
    const pedidos = await prisma.pedido.findMany({ where: { empresaId: req.empresaId }, orderBy: { creadoEn: 'desc' } });
    res.json(pedidos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




// --------- GANANCIAS --------------
async function ingresosTotales(empresaId, mes) {
  const [Y, M] = mes.split('-').map(Number);
  const inicio = new Date(Date.UTC(Y, M - 1, 1));
  const fin    = new Date(Date.UTC(Y, M, 1));

  const citaSum = await prisma.cita.aggregate({
    _sum: { precio: true },
    where: {
      empresaId,
      creadoEn: { gte: inicio, lt: fin }
    }
  });

  const pedidoSum = await prisma.pedido.aggregate({
    _sum: { total: true },
    where: {
      empresaId,
      creadoEn: { gte: inicio, lt: fin }
    }
  });

  const ingresosCitas   = citaSum._sum.precio   || 0;
  const ingresosPedidos = pedidoSum._sum.total   || 0;

  return {
    mes,
    ingresosCitas,
    ingresosPedidos,
    ingresosTotales: ingresosCitas + ingresosPedidos
  };
}

/**
 * Devuelve ingresos desglosados por empleado para citas.
 */
async function ingresosPorEmpleado(empresaId, mes) {
  const [Y, M] = mes.split('-').map(Number);
  const inicio = new Date(Date.UTC(Y, M - 1, 1));
  const fin    = new Date(Date.UTC(Y, M, 1));

  const agregados = await prisma.cita.groupBy({
    by: ['empleadoId'],
    _sum: { precio: true },
    where: {
      empresaId,
      creadoEn: { gte: inicio, lt: fin }
    },
    orderBy: { empleadoId: 'asc' }
  });

  const resultados = await Promise.all(
    agregados.map(async ({ empleadoId, _sum }) => {
      const emp = await prisma.empleado.findUnique({
        where: { id: empleadoId },
        select: { nombre: true, apellido1: true }
      });
      return {
        empleadoId,
        nombre: `${emp.nombre} ${emp.apellido1}`,
        ingresos: _sum.precio || 0
      };
    })
  );

  return { mes, porEmpleado: resultados };
}

// —————— Rutas de Estadísticas ——————

app.get('/api/estadisticas/ingresos', authenticateToken, async (req, res) => {
  const { mes } = req.query;              // p.ej. mes= '2025-07'
  if (!mes) return res.status(400).json({ error: 'Falta el parámetro mes (YYYY-MM)' });
  try {
    const data = await ingresosTotales(req.empresaId, mes);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/estadisticas/por-empleado', authenticateToken, async (req, res) => {
  const { mes } = req.query;
  if (!mes) return res.status(400).json({ error: 'Falta el parámetro mes (YYYY-MM)' });
  try {
    const data = await ingresosPorEmpleado(req.empresaId, mes);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




app.get('/api/estadisticas/nuevos-clientes', authenticateToken, async (req, res) => {
  const { mes } = req.query;
  const empresaId = req.empresaId;

  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ error: 'Mes no válido. Formato esperado: YYYY-MM' });
  }

  const fechaInicio = new Date(`${mes}-01T00:00:00`);
  const fechaFin = new Date(new Date(fechaInicio).setMonth(fechaInicio.getMonth() + 1));

  try {
    // ✅ Todas las citas de la empresa, solo de WhatsApp reales
    const todasLasCitas = await prisma.cita.findMany({
      where: {
        empresaId,
        clienteTelefono: {
          endsWith: '@c.us',
        }
      },
      orderBy: { fechaHora: 'asc' }
    });

    const yaExistentes = new Set();
    const nuevosEsteMes = new Set();

    for (const cita of todasLasCitas) {
      const tel = cita.clienteTelefono;

      if (!yaExistentes.has(tel)) {
        if (cita.fechaHora >= fechaInicio && cita.fechaHora < fechaFin) {
          nuevosEsteMes.add(tel); // 🎯 Primera vez en este mes
        }
        yaExistentes.add(tel); // ❗ Marca como ya existente para el futuro
      }
    }

    res.json({ nuevosClientes: nuevosEsteMes.size, telefonos: Array.from(nuevosEsteMes) });
  } catch (err) {
    console.error('Error al contar nuevos clientes:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});



app.get('/api/estadisticas/ultimas-citas', authenticateToken, async (req, res) => {
  try {
    const ultimasCitas = await prisma.cita.findMany({
      where: { empresaId: req.empresaId },
      orderBy: { creadoEn: 'desc' },
      take: 5,
      select: {
        clienteNombre: true,
        fechaHora: true
      }
    });

    res.json(ultimasCitas);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener últimas citas' });
  }
});




// -------------- Admin -----------------
app.get('/api/admin/empresas', adminAuth, async (req, res) => {
  try {
    const empresas = await prisma.empresa.findMany({
      select: {
        id: true,
        nombre: true,
	direccion:true,
        correo: true,
	telefono:true,
        tipo: true,
        creadoEn: true,
        suscripcionActiva: true,
		botActivo: true
      },
      orderBy: { creadoEn: 'desc' }
    });

    res.json(empresas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/empresa/:id/suscripcion', adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { activa } = req.body;

  try {
    const empresa = await prisma.empresa.update({
      where: { id },
      data: { suscripcionActiva: activa }
    });

    res.json({
      success: true,
      message: `Suscripción ${activa ? 'activada' : 'desactivada'} correctamente`,
      empresa
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Obtener todos los empleados de una empresa específica (admin)
app.get('/api/admin/empresa/:id/empleados', adminAuth, async (req, res) => {
  const empresaId = Number(req.params.id);
  try {
    const empleados = await prisma.empleado.findMany({
      where: { empresaId },
      orderBy: { nombre: 'asc' }
    });
    res.json(empleados);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener todas las citas de una empresa específica (admin)
app.get('/api/admin/empresa/:id/citas', adminAuth, async (req, res) => {
  const empresaId = Number(req.params.id);
  try {
    const citas = await prisma.cita.findMany({
      where: { empresaId },
      orderBy: { fechaHora: 'asc' }
    });
    res.json(citas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/admin/empresa/:id/empleados', adminAuth, async (req, res) => {
  const empresaId = Number(req.params.id);
  const { nombre, apellido1, apellido2, email, telefono, fechaIngreso } = req.body;

  // Validación básica de campos obligatorios
  if (!nombre || !apellido1 || !email) {
    return res.status(400).json({ error: "Nombre, Apellido1 y Email son obligatorios" });
  }

  try {
    const nuevoEmpleado = await prisma.empleado.create({
      data: {
        empresaId,
        nombre,
        apellido1,
        apellido2: apellido2 || "",
        email,
        telefono: telefono || "",
        fechaIngreso: fechaIngreso ? new Date(fechaIngreso) : new Date()
      }
    });
    res.status(201).json(nuevoEmpleado);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});


// DELETE /api/admin/empleado/:id
app.delete('/api/admin/empleado/:id', adminAuth, async (req, res) => {
  const empleadoId = Number(req.params.id);
  try {
    await prisma.empleado.delete({ where: { id: empleadoId } });
    res.json({ message: 'Empleado eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/empleado/:id
app.put('/api/admin/empleado/:id', adminAuth, async (req, res) => {
  const empleadoId = Number(req.params.id);
  const { nombre, apellido1, apellido2, email, telefono, fechaIngreso } = req.body;

  if (!nombre || !apellido1 || !email) {
    return res.status(400).json({ error: "Nombre, Apellido1 y Email son obligatorios" });
  }

  try {
    const empleadoActualizado = await prisma.empleado.update({
      where: { id: empleadoId },
      data: {
        nombre,
        apellido1,
        apellido2,
        email,
        telefono,
        fechaIngreso: fechaIngreso ? new Date(fechaIngreso) : undefined
      }
    });
    res.json(empleadoActualizado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
	
	
// Admin: activar/desactivar bot de cualquier empresa
app.put('/api/admin/bot/:empresaId', async (req, res) => {
  const { empresaId } = req.params;
  const { activo } = req.body;
  const adminToken = req.headers['x-admin-token'];

  // Validar token admin
  if (adminToken !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  if (typeof activo !== 'boolean') {
    return res.status(400).json({ error: 'Valor inválido' });
  }

  try {
    const empresa = await prisma.empresa.update({
      where: { id: Number(empresaId) },
      data: { botActivo: activo },
    });

    res.json({ empresaId: empresa.id, botActivo: empresa.botActivo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar bot' });
  }
});
	


//------------------------------ Bot ---------------------------
app.get('/api/bot', authenticateToken, async (req, res) => {
  const empresa = await prisma.empresa.findUnique({
    where: { id: req.empresaId },
    select: { botActivo: true }
  });

  if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });

  res.json({ botActivo: empresa.botActivo });
});

app.patch('/api/bot', authenticateToken, async (req, res) => {
  const { activo } = req.body;

  if (typeof activo !== 'boolean') {
    return res.status(400).json({ error: 'Valor inválido' });
  }

  await prisma.empresa.update({
    where: { id: req.empresaId },
    data: { botActivo: activo }
  });

  res.json({ mensaje: `Bot ${activo ? 'activado' : 'desactivado'}` });
});



//-------------- Ajustes------------------
app.post('/api/ajustes/qr', authenticateToken, async (req, res) => {
  const { qr } = req.body;
  const empresa = req.empresa || {};
  const empresaId = empresa.id || req.empresaId;

  if (!qr || !empresaId) {
    return res.status(400).json({ error: 'Faltan datos (QR o empresaId)' });
  }

  try {
    // Guardar el QR en la base de datos
    await prisma.empresa.update({
      where: { id: empresaId },
      data: { qr }
    });

    console.log(`📸 QR guardado para empresa ${empresaId}`);
    console.log(qr.slice(0, 100) + '...'); // Mostrar solo el principio

    res.json({ mensaje: 'QR guardado correctamente' });
  } catch (err) {
    console.error('❌ Error guardando el QR:', err.message);
    res.status(500).json({ error: 'Error al guardar el QR' });
  }
});
app.get('/api/ajustes/qr', authenticateToken, async (req, res) => {
  const empresa = req.empresa || {};
  const empresaId = empresa.id || req.empresaId;

  if (!empresaId) {
    return res.status(403).json({ error: 'No se pudo obtener la empresa desde el token' });
  }

  try {
    const datos = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { qr: true }
    });

    if (!datos || !datos.qr) {
      return res.status(404).json({ error: 'QR no encontrado' });
    }

    res.json({ qr: datos.qr });
  } catch (err) {
    console.error('❌ Error obteniendo el QR:', err.message);
    res.status(500).json({ error: 'Error al obtener el QR' });
  }
});


app.get('/api/qr-temporal', (req, res) => {
  if (!qrBase64) {
    return res.status(404).json({ error: 'QR aún no disponible' });
  }
  res.json({ qr: qrBase64 });
});








// —————— Arranque del servidor ——————
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
