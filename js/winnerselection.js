async function selectWinners(
  initTransaction,
  finalizationTransaction,
  loadNextTicketSaleTransaction,
  pubKey
) {
  const initObject = validateInitTransaction(initTransaction, pubKey);
  const initTxid = Buffer.from(bsv.Tx.fromBuffer(initTransaction).id(), "hex");
  const finalizationObject = validateEndTransaction(
    initObject,
    initTxid,
    finalizationTransaction,
    pubKey
  );
  let ticketIds = [];
  let count = 0;
  let nextTicketTx = await loadNextTicketSaleTransaction(count);
  while (nextTicketTx) {
    const ticketId = validateTicketSaleTransaction(
      initTxid,
      nextTicketTx,
      pubKey
    );

    for (let i = 0; i < ticketIds.length; i++) {
      if (ticketIds[i] === ticketId) {
        errorMessage(
          `Failed to select winners. Detected that Ticket Sale transaction with Ticket ID ${ticketId} is being processed more than once.`
        );
        removeLoading();
        return;
      }
    }
      ticketIds.push(ticketId);

    if (ticketIds.length > finalizationObject.soldTicketCount) {
      break;
    }
    count++;
    nextTicketTx = await loadNextTicketSaleTransaction(count);
  }

  if (ticketIds.length !== finalizationObject.soldTicketCount) {
    errorMessage("Failed to select winners. Ticket count does not match with expected count.");
    removeLoading();
    return;
  }

   // sort ticketIds alphabetically
   ticketIds = ticketIds.sort();
  
  const rng = new RNG(
    initObject.initialSeed,
    ...finalizationObject.additionalSeeds
  );
  const sortedRewards = initObject.rewards.sort((a, b) => a.rank - b.rank); // from lowest rank to highest
  const processedRewards = [];
  const percentageWon = Math.ceil(
    (finalizationObject.soldTicketCount / initObject.noOfTickets) * 100
  );
  for (const reward of sortedRewards) {
    const winningTicketIds = [];
    for (let i = 0; i < reward.rewardCount; i++) {
      winningTicketIds.push(
        ticketIds[rng.getNextUInt32({ max: ticketIds.length })]
      );
    }
    processedRewards.push({ reward, percentageWon, winningTicketIds });
  }
  removeLoading();
  showWinnerInfo(processedRewards);
}

function validateInitTransaction(transactionData, pubKey) {
  const {
    messageType,
    signature,
    messageParts: [messageBuf],
  } = parseTransaction(transactionData, 1);
  if (messageType !== 0) {
    console.warn("Error Context:", { messageType, signature, messageBuf, pubKey });
    errorMessage("Failed to select winners. Initialization transaction has unexpected message type.");
    removeLoading();
    return;
  }
  if (!validateSignature(pubKey, signature, [messageBuf])) {
    console.warn("Error Context:", { messageType, signature, messageBuf, pubKey });
    errorMessage("Failed to select winners. Failed to validate signature of initialization transaction.");
    removeLoading();
    return;
  }
  initObject = JSON.parse(messageBuf.toString());
  if (initObject.noOfTickets < 2) {
    console.warn("Error Context:", { initObject, messageType, signature, messageBuf, pubKey });
    errorMessage("Failed to select winners. Initialization transaction specifies less than 2 tickets.");
    removeLoading();
    return;
  }
  if (!initObject.rewards.length) {
    console.warn("Error Context:", { initObject, messageType, signature, messageBuf, pubKey });
    errorMessage("Failed to select winners. Initialization transaction specifies no rewards.");
    removeLoading();
    return;
  }

  if (
    !initObject.rewards.every(
      (item) =>
        item.rewardCount >= 1 &&
        item.rewardPrice &&
        item.rewardTitle &&
        item.description &&
        item.rank > 0
    )
  ) {
    console.warn("Error Context:", { initObject, messageType, signature, messageBuf, pubKey });
    errorMessage("Failed to select winners. Initialization transaction has one or more invalid reward definitions.");
    removeLoading();
    return;
  }

  if (!initObject.initialSeed) {
    console.warn("Error Context:", { initObject, messageType, signature, messageBuf, pubKey });
    errorMessage("Failed to select winners. Initialization transaction lacks an initial seed value.");
    removeLoading();
    return;
  }
  const regexExp = /^[a-f0-9]{64}$/gi;
  if (!regexExp.test(initObject.initialSeed)) {
    console.warn("Error Context:", { initObject, messageType, signature, messageBuf, pubKey });
    errorMessage("Failed to select winners. Initialization transaction lacks has an invalid initial seed value.");
    removeLoading();
    return;
  }

  if (!initObject.additionalSeeds?.length) {
    console.warn("Error Context:", { initObject, messageType, signature, messageBuf, pubKey });
    errorMessage("Failed to select winners. Initialization transaction lacks additional seed values.");
    removeLoading();
    return;
  }

  if (
    !initObject.additionalSeeds.every(
      (additionalSeed) =>
        additionalSeed.description && additionalSeed.regexPattern
    )
  ) {
    console.warn("Error Context:", { initObject, messageType, signature, messageBuf, pubKey });
    errorMessage("Failed to select winners. Initialization transaction has one or more invalid additional seed values.");
    removeLoading();
    return;
  }
  return initObject;
}

function validateEndTransaction(
  initObject,
  realInitTxid,
  transactionData,
  pubKey
) {
  const {
    messageType,
    signature,
    messageParts: [messageBuf],
  } = parseTransaction(transactionData, 1);
  if (messageType !== 2) {
    console.warn("Error Context:", { initObject, realInitTxid, messageType, signature, messageBuf, pubKey });
    errorMessage("Failed to select winners. Finalization transaction has unexpected message type.");
    removeLoading();
  }
  if (!validateSignature(pubKey, signature, [messageBuf])) {
    console.warn("Error Context:", { initObject, realInitTxid, messageType, signature, messageBuf, pubKey });
    errorMessage("Failed to select winners. Failed to validate signature of finalization transaction.");
    removeLoading();
    return;
  }
  endObject = JSON.parse(messageBuf.toString());
  const initTxid = Buffer.from(endObject.initializationTxid, "hex");
  if (!initTxid.equals(realInitTxid)) {
    console.warn("Error Context:", { endObject, initObject, realInitTxid, messageType, signature, messageBuf, pubKey });
    errorMessage("Failed to select winners. Finalization transaction points to a different initialization transaction.");
    removeLoading();
    return;
  }
  if (!endObject.lastTicketSoldTimestamp) {
    console.warn("Error Context:", { endObject, initObject, realInitTxid, messageType, signature, messageBuf, pubKey });
    errorMessage("Failed to select winners. Finalization transaction lacks timestamp of last ticket sale");
    removeLoading();
    return;
  }
  if (!endObject.additionalSeeds.length || !endObject.additionalSeeds[0]) {
    console.warn("Error Context:", { endObject, initObject, realInitTxid, messageType, signature, messageBuf, pubKey });
    errorMessage("Failed to select winners. Finalization transaction does not contain additional seed values.");
    removeLoading();
    return;
  }
  if (endObject.additionalSeeds.length !== initObject.additionalSeeds.length) {
    console.warn("Error Context:", { endObject, initObject, realInitTxid, messageType, signature, messageBuf, pubKey });
    errorMessage("Failed to select winners. Finalization transaction contains an incorrect number of additional seed values.");
    removeLoading();
    return;
  }

  for (let i = 0; i < endObject.additionalSeeds.length; i++) {
    const seed = endObject.additionalSeeds[i];
    const regex = initObject.additionalSeeds[i].regexPattern;
    if (!stringToRegex(regex).test(seed)) {
      console.warn("Error Context:", { endObject, initObject, realInitTxid, messageType, signature, messageBuf, pubKey });
      errorMessage("Failed to select winners. Finalization transaction has one or more additional seed values which do not match the corresponding pattern.");
      removeLoading();
      return;
    }
  }
  return endObject;
}

function validateTicketSaleTransaction(realInitTxid, transactionData, pubKey) {
  const {
    messageType,
    signature,
    messageParts: [initTxidBuf, ticketIdBuf],
  } = parseTransaction(transactionData, 2);
  if (messageType !== 1) {
    console.warn("Error Context:", { realInitTxid, messageType, signature, initTxidBuf, ticketIdBuf, pubKey });
    errorMessage("Failed to select winners. Ticket sale transaction has unexpected message type.");
    removeLoading();

    return;
  }
  if (!validateSignature(pubKey, signature, [initTxidBuf, ticketIdBuf])) {
    console.warn("Error Context:", { realInitTxid, messageType, signature, initTxidBuf, ticketIdBuf, pubKey });
    errorMessage("Failed to select winners. Failed to validate signature of ticket sale transaction.");
    removeLoading();
    return;
  }
  const ticketId = bsv.Base58.fromBuffer(ticketIdBuf).toString();
  //TODO: need to remove raffle id check once seed update issue will resolve
  if (!initTxidBuf.equals(realInitTxid)) {
    console.warn("Error Context:", { ticketId, realInitTxid, messageType, signature, initTxidBuf, ticketIdBuf, pubKey });
    errorMessage("Failed to select winners. Ticket sale transaction points to a different initialization transaction.");
    removeLoading();
    return;
  }

  return ticketId;
}

function parseTransaction(txBuffer, expectedMessageParts) {
  const data = bsv.Tx.fromBuffer(txBuffer);
  const bufferValues = data.txOuts[0].script.chunks.map((item) => item.buf);
  const messageType = bufferValues[2];
  const signature = bufferValues[3];
  const restOfChunks = bufferValues.slice(4);
  const messageParts = restOfChunks.filter((i) => i).map((i) => i);

  if (restOfChunks.length > messageParts.length)
    console.log(
      "Transaction was expected to end with Message Part variables and nothing else"
    );
  if (!messageType) {
    return;
  }
  if (messageType.length !== 1) {
    return;
  }
  if (!signature) {
    return;
  }
  if (signature.length < 50) {
    return;
  }
  if (messageParts.length !== expectedMessageParts) {
    return;
  }
  return {
    messageType: messageType?.readInt8(),
    signature: bsv.Sig.fromBuffer(signature),
    messageParts,
  };
}

function validateSignature(pubKey, signature, messageParts) {
  const bsv = window.bsvjs;

  const hash = bsv.Hash.sha256(Buffer.concat(messageParts));
  return bsv.Ecdsa.verify(hash, signature, pubKey);
}
