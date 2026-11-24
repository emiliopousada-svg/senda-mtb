// Keeps each public account nickname unique and stable once selected.
const validateUserNickname = (e) => {
    const userNicknameKey = (value) => String(value || "")
        .trim()
        .replace(/\s+/g, " ")
        .normalize("NFKC")
        .toLowerCase()
        .normalize("NFKC");

    const isSuperuser = e.hasSuperuserAuth();
    const isNew = e.record.isNew();
    const originalNickname = isNew ? "" : e.record.original().getString("nickname");
    const nickname = e.record.getString("nickname").trim().replace(/\s+/g, " ");
    const nicknameKey = userNicknameKey(nickname);
    const originalNicknameKey = userNicknameKey(originalNickname);

    if (!isSuperuser && !isNew && originalNickname && nickname !== originalNickname) {
        throw new BadRequestError("El apodo no se puede cambiar una vez elegido.");
    }
    if (nickname.length > 32) throw new BadRequestError("El apodo no puede superar los 32 caracteres.");
    if (!isSuperuser && nicknameKey === "senda-mtb" && originalNicknameKey !== "senda-mtb") {
        throw new BadRequestError("Ese apodo está reservado.");
    }
    e.record.set("nicknameKey", nicknameKey);
    if (isSuperuser) return e.next();

    // Existing or legacy accounts without a nickname remain valid; unrelated profile updates
    // do not query for duplicates or rewrite the public nickname.
    if (nickname === originalNickname) return e.next();
    if (!nickname) return e.next();

    const matches = $app.findRecordsByFilter(
        "users",
        "id != {:id} && nicknameKey = {:nicknameKey}",
        "",
        1,
        0,
        { id: e.record.id, nicknameKey: nicknameKey }
    );
    if (matches.length) throw new BadRequestError("Ese apodo ya está en uso.");

    e.record.set("nickname", nickname);
    e.next();
};

onRecordCreateRequest(validateUserNickname, "users");
onRecordUpdateRequest(validateUserNickname, "users");
