---
title: Linear regression in a nutshell
date: 2025-06-03T20:00:00.146Z
draft: false
featured: false
image:
  filename: featured
  focal_point: Smart
  preview_only: false
---

{{< katex >}}

## Introduction

These notes are written as a quick reference on ordinary least squares (OLS) regression.
I have more detailed notes in pdf form (here)[https://rayhagimoto.pages.io/linear-regression-notes/linear_regression.pdf].

Suppose we have a dataset \(\mathcal{D} = \{(x_i, y_i) : i = 1, 2, \dots, n\}\), where \( x_i \in \mathbb{R} \) is a scalar covariate and \( y_i \in \mathbb{R} \) is the response. We assume this data is drawn i.i.d. from some unknown distribution \( p(x, y) \). Since we’re interested in predicting \( y \) from \( x \), it’s natural to factor the joint distribution as:

\[
p(x, y) = p(y \mid x)\, p(x)
\]

In linear regression, we posit a parametric model for the conditional distribution:

\[
p(y \mid x; \beta) \propto \exp\left( -\frac{1}{2\sigma^2} [y - f(x; \beta)]^2 \right)
\]

where \( f(x; \beta) = \beta_0 + \beta_1 x \) and \( \sigma^2 \) is a fixed noise variance. This is equivalent to the model:

\[
y = \beta_0 + \beta_1 x + \varepsilon \;, \quad \varepsilon \sim \mathcal{N}(0, \sigma^2)
\]

The goal is to find parameters \( \beta_0 \) and \( \beta_1 \) that minimize the squared residuals. Define the loss function:

\[
L(\beta_0, \beta_1) = \sum_{i=1}^n \left(y_i - \beta_0 - \beta_1 x_i\right)^2
\]

Minimizing \( L \) with respect to \( \beta_0 \) and \( \beta_1 \) yields the closed-form solution:

\[
\hat{\beta}_1 = \frac{\sum_i (x_i - \bar{x})(y_i - \bar{y})}{\sum_i (x_i - \bar{x})^2} \quad \text{and} \quad \hat{\beta}_0 = \bar{y} - \hat{\beta}_1 \bar{x}
\]

where \( \bar{x} = \frac{1}{n} \sum_i x_i \) and \( \bar{y} = \frac{1}{n} \sum_i y_i \).

## Multivariate Case

Now consider the general multivariate case where each input is a vector \( \mathbf{x}_i \in \mathbb{R}^p \). To include the intercept \( \beta_0 \), we prepend a 1 to each input vector. That is, we define the augmented input vector \( \tilde{\mathbf{x}}_i = [1, x_{i1}, x_{i2}, \dots, x_{ip}]^\mathsf{T} \in \mathbb{R}^{p+1} \).

Stack the data into matrices:

- Let \( X \in \mathbb{R}^{n \times (p+1)} \) be the design matrix with rows \( \tilde{\mathbf{x}}_i^\mathsf{T} \),
- Let \( Y \in \mathbb{R}^{n} \) be the response vector.

The model is:

\[
Y = X \beta + \varepsilon \;, \quad \varepsilon \sim \mathcal{N}(0, \sigma^2 I)
\]

where \( \beta \in \mathbb{R}^{p+1} \) includes the intercept term as its first entry.

Maximizing the likelihood (or equivalently minimizing squared error) yields the OLS estimator:

\[
\hat{\beta}_\mathrm{OLS} = (X^\mathsf{T} X)^{-1} X^\mathsf{T} Y
\]

This formula generalizes the scalar case and provides a fast, closed-form solution when \( X^\mathsf{T} X \) is invertible.
We will discuss more about when \(X^\mathsf{T} X\) is invertible in the section on multicollinearity.




## Assumptions

Before we apply the OLS estimator, it's worth reviewing the key assumptions that underpin it. These assumptions aren't always strictly satisfied in practice — in fact, they’re often violated to some degree. But knowing what assumptions we're making helps us understand when and why the OLS results might be misleading.

{{< primarybg >}}
### OLS Regression Assumptions
1. **Linearity**  
1. **Random sampling**  
1. **No perfect multicollinearity**  
1. **No weak exogeneity**  
1. **Homoscedasticity**  
1. **Uncorrelated errors**  
1. **Errors follow a distribution**  
1. **Model specification**
{{< /primarybg >}}

#### **Linearity**

This means that the response \(y\) is linear wrt the parameters \(\beta\).
For example, if we had two covariates \(x_1\) and \(x_2\), we are assuming that
\(y = \beta_0 + \beta_1 x_1 + \beta_2 x_2\).
The covariates may themselves be nonlinear functions of an underlying variable, e.g. we could model
\(y = \beta_0 + \beta_1 x^2\).

#### **Random sampling**

The data samples \((x_i, y_i)\) are assumed to be IID.

#### **Homoscedasticity**

Residuals have constant variance: \(\mathrm{Var}(\varepsilon_i) = \sigma^2\) for all \(i\).

#### **Uncorrelated errors**

Residuals are not autocorrelated. That is, they satisfy  
\(\mathrm{Cov}(\varepsilon_i, \varepsilon_j) = 0\) for \(i \ne j\).

#### **No perfect multicollinearity**

If you have multiple covariates, perfect multicollinearity means that a subset of the covariates are linearly dependent.
The simplest example would be \(x_1 = x_2\). More generally, it means there exists a relationship like
\(x_{m_1} + x_{m_2} + \cdots + x_{m_s} = 0\),
where \(m_i\) are the indices of the \(s\) multicollinear covariates.
Although the assumption is that there is no _perfect_ multicollinearity, even if there is strong multicollinearity OLS regression
becomes unreliable, even if the asymptotic properties still hold.

#### **Errors follow a distribution**

This is optional, but we typically assume that the residuals are i.i.d Gaussian:  
\(\varepsilon \sim N(0, \sigma^2)\).

#### **Model specification**

This is a very subtle and easy-to-forget assumption, which basically says that we assume the model is true. In other words, not only do we assume that the true relationship is linear, but also that the only covariates are precisely the ones we included in our formula. This means that we’re assuming there are no other omitted covariates that influence the response (I'm using the word "cause" very loosely here).

---

## Significance Testing

After fitting the OLS model, we often want to assess whether each coefficient \( \beta_j \) is statistically different from zero. This is typically done using a _t-test_, which tests the null hypothesis \( H_0: \beta_j = 0 \) against the alternative \( H_1: \beta_j \ne 0 \).

### General form

The test statistic for coefficient \( \hat{\beta}_j \) is given by:

$$
t_j = \frac{ \hat{\beta}_j }{ \widehat{\mathrm{SE}}(\hat{\beta}_j) }
$$

where \( \widehat{\mathrm{SE}}(\hat{\beta}_j) \) is the estimated standard error of \( \hat{\beta}_j \). Under the null hypothesis, and assuming the OLS assumptions hold (particularly homoscedasticity and Gaussian errors), this statistic approximately follows a Student’s t-distribution with \( n - p - 1 \) degrees of freedom, where \( p \) is the number of covariates.
(For example if our model is \( y = \beta_0 + \beta_1 x \) then \(p = 1\)).

---

### Univariate case

For the simple regression model \( y = \beta_0 + \beta_1 x + \varepsilon \), we define the residual variance:

$$
\hat{\sigma}^2 = \frac{1}{n - 2} \sum_{i=1}^n \left( y_i - \hat{y}_i \right)^2 = \frac{1}{n - 2} \sum_{i=1}^n \left( y_i - \hat{\beta}_0 - \hat{\beta}_1 x_i \right)^2
$$

Then the standard error of the slope estimator \( \hat{\beta}_1 \) is:

$$
\widehat{\mathrm{SE}}(\hat{\beta}_1) = \sqrt{ \frac{ \hat{\sigma}^2 }{ \sum_i (x_i - \bar{x})^2 } }
$$

and the t-statistic becomes:

$$
t_1 = \frac{ \hat{\beta}_1 }{ \widehat{\mathrm{SE}}(\hat{\beta}_1) }
$$

The corresponding p-value is computed from the t-distribution with \( n - 2 \) degrees of freedom.

The standard error of the intercept \( \hat{\beta}_0 \) is:

$$
\widehat{\mathrm{SE}}(\hat{\beta}_0) = \sqrt{ \hat{\sigma}^2 \left( \frac{1}{n} + \frac{ \bar{x}^2 }{ \sum_i (x_i - \bar{x})^2 } \right) } \; .
$$

---

### Multivariate case

In the multivariate case, the estimated covariance matrix of \( \hat{\beta}_\mathrm{OLS} \) is:

$$
\widehat{\mathrm{Cov}}(\hat{\beta}) = \hat{\sigma}^2 (X^\mathsf{T} X)^{-1}
$$

where \( \hat{\sigma}^2 = \frac{1}{n - p - 1} \| Y - X \hat{\beta} \|^2 \) is the residual variance.

Then for the \( j \)-th coefficient, the standard error is:

$$
\widehat{\mathrm{SE}}(\hat{\beta}_j) = \sqrt{ \left[ \widehat{\mathrm{Cov}}(\hat{\beta}) \right]_{jj} }
$$

and the t-statistic is:

$$
t_j = \frac{ \hat{\beta}_j }{ \widehat{\mathrm{SE}}(\hat{\beta}_j) }
$$

The derivation for these formulas is really easy in the multivariate case. 

---

### Practical use and limitations

In practice, these t-tests are used to assess the individual relevance of each covariate. A small p-value (e.g., < 0.05) suggests evidence against the null \( \beta_j = 0 \), implying the corresponding feature may have predictive value.

However, there are important caveats:

- **Multiple comparisons**: If many covariates are tested, some will appear significant by chance. Adjustments (e.g. Bonferroni correction) may be needed.
- **Model misspecification**: If the model omits relevant variables or includes irrelevant ones, the significance test can be misleading.
- **Multicollinearity**: High correlation between features inflates standard errors, making it harder to detect significance even when the variable matters.
- **Non-Gaussian errors**: The test assumes normally distributed residuals. When this fails, especially in small samples, the p-values may be unreliable.

For these reasons, t-tests are often viewed as a rough diagnostic rather than a definitive decision tool. In applied settings (including finance), it is common to combine statistical significance with out-of-sample validation and domain knowledge.


---


## **Violating the assumptions**

What happens when the assumptions are violated?

### Heteroscedasticity

When the error variance \(\sigma^2\) is not constant the OLS estimator becomes inefficient
