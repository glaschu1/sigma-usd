import { addReq, getWalletAddress } from './helpers';
import { Address } from '@coinbarn/ergo-ts';
import { follow, p2s } from './assembler';
import { dollarToCent } from './serializer';
import {
    amountFromRedeemingRc,
    amountFromRedeemingSc,
    forceUpdateState,
    rcTokenId,
    redeemScTx,
    scTokenId
} from './ageHelper';
import moment from 'moment';
import { minErgVal, reserveAcronym, usdAcronym, usdName } from './consts';

const template = `{
  val scTokenId = fromBase64("$scTokenId")
  val properRedeeming = {
    val myOut = OUTPUTS(1)
    myOut.propositionBytes == fromBase64("$userAddress") &&
      myOut.value >= $redeemAmountL && HEIGHT < $timestampL &&
      CONTEXT.dataInputs(0).id == fromBase64("$oracleBoxId")
  }
  val returnFunds = {
    val total = INPUTS.fold(0L, {(x:Long, b:Box) => x + b.value}) - 4000000
    val totalInSc = INPUTS.fold(0L, {(x:Long, b:Box) => {
      val tok = b.tokens.getOrElse(0, (scTokenId, 0L))
      if (tok._1 == scTokenId) tok._2
      else 0L
    }})
    val tok = OUTPUTS(0).tokens.getOrElse(0, (scTokenId, 0L))
    OUTPUTS(0).value >= total && OUTPUTS(0).propositionBytes == fromBase64("$userAddress") &&
      ((tok._1 == scTokenId && tok._2 == totalInSc) || totalInSc == 0)
  }
  sigmaProp(properRedeeming || returnFunds)
}`;

export async function redeemSc(amount) {
    await forceUpdateState()

    let ourAddr = getWalletAddress();
    let ergGet = (await amountFromRedeemingSc(amount) / 1e9)
    let tx = await redeemScTx(amount)
    for (let i = 0; i < tx.requests.length; i++) {
        if (tx.requests[i].value < minErgVal) throw new Error("Too little value!")
    }

    let addr = (await getScRedeemP2s(tx.requests[1].value, tx.dataInputs[0])).address
    let request = {
        address: addr,
        returnTo: ourAddr,
        startWhen: {
            erg: 10000000
        },
        txSpec: tx,
    };
    request.startWhen[await scTokenId()] = dollarToCent(amount)
    request.startWhen[await rcTokenId()] = 0
    return follow(request).then(res => {
        if (res.id !== undefined) {
            let toFollow = {
                id: res.id,
                address: addr,
                info: {
                    address: addr,
                    returnTo: ourAddr,
                    get: `+${ergGet.toFixed(2)} ERG`,
                    pay: `-${amount} ${usdAcronym}`,
                    type: `Redeem ${usdAcronym}`,
                    sign: '$',
                    timestamp: moment().valueOf()
                },
                key: 'operation',
                status: 'follow',
                operation: 'redeeming stablecoin'
            };
            addReq(toFollow, 'reqs')
            res.addr = addr
        }
        return res
    })
}

export async function getScRedeemP2s(amount, oracleBoxId) {
    let ourAddr = getWalletAddress();
    let userTreeHex = new Address(ourAddr).ergoTree
    let userTree = Buffer.from(userTreeHex, 'hex').toString('base64');

    let scTokenId64 = Buffer.from(await scTokenId(), 'hex').toString('base64')
    let oracleBoxId64 = Buffer.from(oracleBoxId, 'hex').toString('base64')

    let script = template
        .replaceAll('$userAddress', userTree)
        .replaceAll('$redeemAmount', amount)
        .replaceAll('$scTokenId', scTokenId64)
        .replaceAll('$oracleBoxId', oracleBoxId64)
        .replaceAll('$timestamp', moment().valueOf())
        .replaceAll('\n', '\\n');
    return p2s(script);
}
