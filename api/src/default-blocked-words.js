'use strict';

// Palabras que la app ya trae por defecto. Todas las instalaciones las tienen,
// asi que en el ranking solo aportan ruido: se descartan al recibir el
// snapshot y se borran las ya guardadas (jobs.purgeDefaultBlockedWords).
// Sacada de las palabras con 100 % de usuarios en el panel (06/11/2026).
module.exports = [
  'boluda', 'boludo', 'cabron', 'cabrona', 'caca', 'carajo', 'chingada', 'chingar',
  'cojon', 'cojones', 'concha', 'coño', 'culero', 'culo', 'desgraciada', 'desgraciado',
  'entro al live', 'estupida', 'estupido', 'forra', 'forro', 'gilipollas', 'hijoputa',
  'hijueputa', 'hostia', 'idiota', 'imbecil', 'joder', 'kyc', 'maldita', 'maldito',
  'mamahuevo', 'mamon', 'mamona', 'marica', 'maricon', 'mierda', 'mongol', 'mongolo',
  'negro de mierda', 'pedo', 'pelotuda', 'pelotudo', 'pendeja', 'pendejo', 'pinche',
  'pito', 'pollas', 'prostituta', 'puta', 'puto', 'retrasada', 'retrasado', 'subnormal',
  'verga', 'zorra',
];
