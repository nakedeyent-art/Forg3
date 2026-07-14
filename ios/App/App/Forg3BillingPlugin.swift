import Capacitor
import Foundation
import StoreKit
import UIKit

@objc(Forg3BillingPlugin)
public class Forg3BillingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "Forg3BillingPlugin"
    public let jsName = "Forg3Billing"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restorePurchases", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manageSubscriptions", returnType: CAPPluginReturnPromise)
    ]

    @objc func purchase(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.reject("StoreKit purchases require iOS 15 or newer.")
            return
        }

        guard let productId = call.getString("productId"), !productId.trimmingCharacters(in: .whitespaces).isEmpty else {
            call.reject("productId is required.")
            return
        }

        Task {
            do {
                let products = try await Product.products(for: [productId])
                guard let product = products.first else {
                    reject(call, "Store product is not configured or not available for this App Store account.")
                    return
                }

                let purchaseResult = try await product.purchase()
                switch purchaseResult {
                case .success(let verification):
                    let signedTransactionInfo = verification.jwsRepresentation
                    let transaction = try checkVerified(verification)
                    await transaction.finish()
                    resolve(call, transactionPayload(transaction, signedTransactionInfo: signedTransactionInfo))
                case .userCancelled:
                    reject(call, "Purchase canceled.")
                case .pending:
                    reject(call, "Purchase is pending approval.")
                @unknown default:
                    reject(call, "Purchase ended in an unsupported state.")
                }
            } catch {
                reject(call, error.localizedDescription)
            }
        }
    }

    @objc func restorePurchases(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.reject("StoreKit purchases require iOS 15 or newer.")
            return
        }

        Task {
            do {
                try await AppStore.sync()
                var purchases: [[String: Any]] = []

                for await entitlement in Transaction.currentEntitlements {
                    if case .verified(let transaction) = entitlement {
                        purchases.append(transactionPayload(transaction, signedTransactionInfo: entitlement.jwsRepresentation))
                    }
                }

                resolve(call, ["purchases": purchases])
            } catch {
                reject(call, error.localizedDescription)
            }
        }
    }

    @objc func manageSubscriptions(_ call: CAPPluginCall) {
        guard let url = URL(string: "https://apps.apple.com/account/subscriptions") else {
            call.reject("Subscription management URL is unavailable.")
            return
        }

        DispatchQueue.main.async {
            UIApplication.shared.open(url)
            call.resolve(["opened": true])
        }
    }

    @available(iOS 15.0, *)
    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .verified(let safe):
            return safe
        case .unverified(_, let error):
            throw error
        }
    }

    @available(iOS 15.0, *)
    private func transactionPayload(_ transaction: Transaction, signedTransactionInfo: String) -> [String: Any] {
        var payload: [String: Any] = [
            "providerReceipt": signedTransactionInfo,
            "signedTransactionInfo": signedTransactionInfo,
            "transactionId": String(transaction.id),
            "productId": transaction.productID
        ]

        if #available(iOS 16.0, *) {
            payload["providerEnvironment"] = String(describing: transaction.environment)
        }

        return payload
    }

    private func resolve(_ call: CAPPluginCall, _ data: [String: Any]) {
        DispatchQueue.main.async {
            call.resolve(data)
        }
    }

    private func reject(_ call: CAPPluginCall, _ message: String) {
        DispatchQueue.main.async {
            call.reject(message)
        }
    }
}
