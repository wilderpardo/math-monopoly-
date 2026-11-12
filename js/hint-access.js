export function hintAccessMessage(error, action='leer') {
    const denied=error?.code==='permission-denied' || /permission|insufficient/i.test(error?.message||'');
    return denied
        ? `Firebase no permite ${action} las pistas con esta cuenta. Revisa los permisos de la colección hints en las reglas publicadas. No se han confirmado los datos de pistas.`
        : `No se pudieron ${action} las pistas: ${error?.message||'revisa la conexión e inténtalo de nuevo.'}`;
}
